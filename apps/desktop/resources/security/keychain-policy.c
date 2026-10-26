/**
 * [INPUT]: macOS Security framework and stable Node-API v8.
 * [OUTPUT]: disableInteraction(), which confirms that Keychain UI is disabled for this process.
 * [POS]: Native main-process policy; no credential access, ACL edits or system-wide preference changes.
 */
#include <Security/Security.h>
#include <node_api.h>
#include <stdbool.h>

static napi_value disable_interaction(napi_env env, napi_callback_info info) {
  (void)info;
  Boolean allowed = true;
  // Chromium's file-based Keychain still requires the process-wide legacy policy.
  OSStatus status = SecKeychainSetUserInteractionAllowed(false);
  if (status == errSecSuccess) status = SecKeychainGetUserInteractionAllowed(&allowed);
  napi_value result;
  if (napi_get_boolean(env, status == errSecSuccess && !allowed, &result) != napi_ok) return NULL;
  return result;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value callback;
  if (napi_create_function(env, "disableInteraction", NAPI_AUTO_LENGTH, disable_interaction, NULL, &callback) != napi_ok ||
      napi_set_named_property(env, exports, "disableInteraction", callback) != napi_ok) return NULL;
  return exports;
}

NAPI_MODULE(bottega_keychain_policy, initialize)
