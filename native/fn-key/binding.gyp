{
  "targets": [
    {
      "target_name": "fn_key",
      "sources": ["src/fn_key.c"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "MACOSX_DEPLOYMENT_TARGET": "11.0",
              "OTHER_LDFLAGS": ["-framework ApplicationServices", "-framework CoreFoundation"]
            }
          }
        ]
      ]
    }
  ]
}
