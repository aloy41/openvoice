export interface VoiceErrorInfo {
  code: string;
  message: string;
}

/** Map getUserMedia/device failures to actionable, non-technical messages. */
export function describeMediaError(e: unknown): VoiceErrorInfo {
  if (e instanceof DOMException) {
    switch (e.name) {
      case "NotAllowedError":
        return {
          code: "mic_permission_denied",
          message:
            "Microphone access was denied. Allow microphone access for this site in your browser settings, then try again.",
        };
      case "NotFoundError":
      case "OverconstrainedError":
        return {
          code: "no_input_device",
          message: "No usable microphone was found. Connect a microphone and try again.",
        };
      case "NotReadableError":
        return {
          code: "device_in_use",
          message:
            "The microphone could not be started — another application may be using it.",
        };
    }
  }
  return { code: "mic_error", message: "The microphone could not be started." };
}

export function describeTokenError(code: string | undefined): VoiceErrorInfo {
  switch (code) {
    case "session_expired":
      return { code, message: "Your session expired. Sign in again to rejoin." };
    case "session_invalid":
    case "not_authenticated":
      return { code, message: "Your session is no longer valid. Sign in again." };
    default:
      return {
        code: code ?? "token_error",
        message: "Could not authorize the voice connection. Try again in a moment.",
      };
  }
}

export const CONNECT_FAILED: VoiceErrorInfo = {
  code: "media_server_unreachable",
  message:
    "Could not reach the voice server. Check that LiveKit is running and that UDP/WebSocket ports are not blocked, then try again.",
};
