// Helper function to get signed URL for authenticated conversations
export async function getSignedUrl(
  ELEVENLABS_AGENT_ID,
  ELEVENLABS_API_KEY,
  retryCount = 0
) {
  console.log("[Inside getSignedUrl] ELEVENLABS_AGENT_ID", ELEVENLABS_AGENT_ID);

  if (!ELEVENLABS_AGENT_ID || !ELEVENLABS_API_KEY) {
    throw new Error(
      "Missing required ElevenLabs credentials: ELEVENLABS_AGENT_ID or ELEVENLABS_API_KEY"
    );
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${ELEVENLABS_AGENT_ID}`,
      {
        method: "GET",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 10000, // 10 second timeout
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`ElevenLabs API error (${response.status}): ${errorText}`);

      // Handle rate limiting with exponential backoff
      if (response.status === 429 && retryCount < 3) {
        const delay = Math.pow(2, retryCount) * 1000;
        console.log(
          `Rate limited by ElevenLabs API, retrying in ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return getSignedUrl(
          ELEVENLABS_AGENT_ID,
          ELEVENLABS_API_KEY,
          retryCount + 1
        );
      }

      throw new Error(
        `Failed to get signed URL: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = await response.json();

    if (!data.signed_url) {
      throw new Error("No signed_url in ElevenLabs response");
    }

    console.log("[ElevenLabs] Successfully obtained signed URL");
    return data.signed_url;
  } catch (error) {
    console.error("Error getting ElevenLabs signed URL:", error);

    // Retry for network errors or timeouts
    if (
      (error.name === "TypeError" ||
        error.name === "AbortError" ||
        error.code === "ECONNRESET") &&
      retryCount < 3
    ) {
      const delay = Math.pow(2, retryCount) * 1000;
      console.log(
        `Network error connecting to ElevenLabs API, retrying in ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return getSignedUrl(
        ELEVENLABS_AGENT_ID,
        ELEVENLABS_API_KEY,
        retryCount + 1
      );
    }

    throw error;
  }
}
