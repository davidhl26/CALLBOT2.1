import { WebSocket } from "ws";
import { hangupCall } from "./telnyx.js";

/**
 * Cleanly close a call by hanging up and closing all associated websockets
 * @param {string} callControlId - The Telnyx call control ID
 * @param {WebSocket} telnyxWs - The Telnyx websocket connection
 * @param {WebSocket} elevenLabsWs - The ElevenLabs websocket connection
 * @returns {Promise<object|null>} - The response from hangupCall or null if it failed
 */
export const cleanupCall = async (callControlId, telnyxWs, elevenLabsWs) => {
  console.log("[Cleanup] Starting call cleanup process");

  // First try to hangup the call
  let hangupResponse = null;
  if (callControlId) {
    try {
      hangupResponse = await hangupCall(callControlId);
      if (hangupResponse?.data) {
        console.log("[Cleanup] Hangup response:", hangupResponse.data);
      }
    } catch (error) {
      console.error(
        "[Cleanup] Error hanging up call:",
        error.response?.data || error.message || error
      );
    }
  }

  // Close the ElevenLabs websocket if it's open
  if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
    try {
      console.log("[Cleanup] Closing ElevenLabs websocket");
      elevenLabsWs.close();
    } catch (error) {
      console.error("[Cleanup] Error closing ElevenLabs websocket:", error);
    }
  }

  // Close the Telnyx websocket if it's open
  if (telnyxWs && telnyxWs.readyState === WebSocket.OPEN) {
    try {
      console.log("[Cleanup] Closing Telnyx websocket");
      telnyxWs.close();
    } catch (error) {
      console.error("[Cleanup] Error closing Telnyx websocket:", error);
    }
  }

  return hangupResponse;
};
