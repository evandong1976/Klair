// Klair fn/globe key listener (macOS). Electron's globalShortcut can't bind fn alone,
// so this addon watches keyboard events with a listen-only CGEventTap and reports:
//   'down' / 'up'  fn pressed / released (so Klair knows when fn is being held)
//   'tap'          fn pressed and released with no other key in between
//   'chord', 'p'   fn held + P   (pause / resume)
//   'chord', 'q'   fn held + Q   (quiet for 30 min)
//   'chord', '1'–'9'   fn held + digit   (switch to that session)
// Requires the Input Monitoring permission. Listen-only: it never blocks or changes keys.
//
// Build on the Mac with `pnpm build:native`; see docs/PROGRESS.md.
#include <node_api.h>
#include <ApplicationServices/ApplicationServices.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdlib.h>

#define KEY_FN 63
#define KEY_GLOBE 179
#define KEY_P 35
#define KEY_Q 12

typedef struct {
  int kind; // 0 = tap, 1 = chord, 2 = down, 3 = up
  char key;
} FnEvent;

static napi_threadsafe_function tsfn = NULL;
static CFMachPortRef tap = NULL;
static CFRunLoopSourceRef source = NULL;
static CFRunLoopRef loop = NULL;
static pthread_t thread;
static bool running = false;
static bool fn_down = false;
static bool other_key = false;

static void call_js(napi_env env, napi_value cb, void *context, void *data) {
  FnEvent *e = (FnEvent *)data;
  if (env != NULL && cb != NULL) {
    napi_value argv[2];
    napi_value global;
    static const char *NAMES[4] = {"tap", "chord", "down", "up"};
    napi_create_string_utf8(env, NAMES[e->kind & 3], NAPI_AUTO_LENGTH, &argv[0]);
    if (e->kind == 1) {
      char k[2] = {e->key, 0};
      napi_create_string_utf8(env, k, 1, &argv[1]);
    } else {
      napi_get_undefined(env, &argv[1]);
    }
    napi_get_global(env, &global);
    napi_call_function(env, global, cb, 2, argv, NULL);
  }
  free(e);
}

static void emit(int kind, char key) {
  if (tsfn == NULL) return;
  FnEvent *e = (FnEvent *)malloc(sizeof(FnEvent));
  if (e == NULL) return;
  e->kind = kind;
  e->key = key;
  napi_call_threadsafe_function(tsfn, e, napi_tsfn_nonblocking);
}

static CGEventRef on_event(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *refcon) {
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    if (tap != NULL) CGEventTapEnable(tap, true);
    return event;
  }
  int64_t keycode = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
  if (type == kCGEventFlagsChanged && (keycode == KEY_FN || keycode == KEY_GLOBE)) {
    bool down = (CGEventGetFlags(event) & kCGEventFlagMaskSecondaryFn) != 0;
    if (down && !fn_down) {
      fn_down = true;
      other_key = false;
      emit(2, 0);
    } else if (!down && fn_down) {
      fn_down = false;
      emit(3, 0);
      if (!other_key) emit(0, 0);
    }
  } else if (type == kCGEventFlagsChanged && fn_down) {
    other_key = true; // another modifier joined fn
  } else if (type == kCGEventKeyDown && fn_down) {
    other_key = true;
    if (keycode == KEY_P) emit(1, 'p');
    else if (keycode == KEY_Q) emit(1, 'q');
    else {
      // fn + 1–9: switch session. ANSI key codes for the digit row (not in numeric order).
      static const int64_t DIGITS[9] = {18, 19, 20, 21, 23, 22, 26, 28, 25};
      for (int i = 0; i < 9; i++) {
        if (keycode == DIGITS[i]) {
          emit(1, (char)('1' + i));
          break;
        }
      }
    }
  }
  return event;
}

static void *run_loop(void *arg) {
  loop = CFRunLoopGetCurrent();
  CFRunLoopAddSource(loop, source, kCFRunLoopCommonModes);
  CGEventTapEnable(tap, true);
  CFRunLoopRun();
  return NULL;
}

static napi_value start(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_value result;
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (running) {
    napi_get_boolean(env, true, &result);
    return result;
  }
  if (!CGPreflightListenEventAccess()) {
    CGRequestListenEventAccess(); // shows the Input Monitoring prompt
    napi_get_boolean(env, false, &result);
    return result;
  }
  CGEventMask mask = CGEventMaskBit(kCGEventFlagsChanged) | CGEventMaskBit(kCGEventKeyDown);
  tap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionListenOnly,
                         mask, on_event, NULL);
  if (tap == NULL) {
    napi_get_boolean(env, false, &result);
    return result;
  }
  source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0);
  napi_value name;
  napi_create_string_utf8(env, "klair-fn-key", NAPI_AUTO_LENGTH, &name);
  napi_create_threadsafe_function(env, argv[0], NULL, name, 0, 1, NULL, NULL, NULL, call_js, &tsfn);
  napi_unref_threadsafe_function(env, tsfn); // don't keep the process alive
  pthread_create(&thread, NULL, run_loop, NULL);
  running = true;
  napi_get_boolean(env, true, &result);
  return result;
}

static napi_value stop(napi_env env, napi_callback_info info) {
  if (running) {
    if (tap != NULL) CGEventTapEnable(tap, false);
    if (loop != NULL) CFRunLoopStop(loop);
    pthread_join(thread, NULL);
    if (source != NULL) CFRelease(source);
    if (tap != NULL) CFRelease(tap);
    source = NULL;
    tap = NULL;
    loop = NULL;
    if (tsfn != NULL) napi_release_threadsafe_function(tsfn, napi_tsfn_release);
    tsfn = NULL;
    running = false;
  }
  return NULL;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value fn_start, fn_stop;
  napi_create_function(env, "start", NAPI_AUTO_LENGTH, start, NULL, &fn_start);
  napi_create_function(env, "stop", NAPI_AUTO_LENGTH, stop, NULL, &fn_stop);
  napi_set_named_property(env, exports, "start", fn_start);
  napi_set_named_property(env, exports, "stop", fn_stop);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
