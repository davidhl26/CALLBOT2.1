// ... existing code ...

// Generate a unique session ID for tracking
const generateSessionId = () => uuidv4().substring(0, 8);

fastify.register(async (fastify) => {
  fastify.get("/media-stream2", { websocket: true }, (connection, req) => {
    const sessionId = generateSessionId();
    let lastActivity = Date.now();
    let isClosing = false;

    const logger = {
      info: (message) => console.log(`[${sessionId}] ${message}`),
      error: (message) => console.error(`[${sessionId}] ERROR: ${message}`),
      debug: (message) => console.debug(`[${sessionId}] DEBUG: ${message}`),
    };

    logger.info("New WebSocket connection established");

    const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
    // console.log("🚀 ~ deepgram:", deepgram);
    // console.log("🚀 ~ deepgram:", process.env.DEEPGRAM_API_KEY);
    let sttConnection;
    let activityCheckInterval;

    // Activity monitoring to prevent automatic disconnects
    const resetActivityTimer = () => {
      lastActivity = Date.now();
      if (!activityCheckInterval) {
        activityCheckInterval = setInterval(() => {
          if (Date.now() - lastActivity > 30000) {
            // 30s timeout
            logger.error("Inactivity timeout - closing connection");
            safeClose();
          }
        }, 5000);
      }
    };

    const safeClose = () => {
      if (isClosing) return;
      isClosing = true;

      logger.info("Starting graceful shutdown");

      clearInterval(activityCheckInterval);

      try {
        if (sttConnection?.getReadyState() === "open") {
          sttConnection.finish();
          logger.debug("Deepgram connection closed");
        }
      } catch (error) {
        logger.error("Error closing Deepgram connection: " + error.message);
      }

      try {
        if (connection.socket.readyState === WebSocket.OPEN) {
          connection.socket.close();
          logger.debug("WebSocket connection closed");
        }
      } catch (error) {
        logger.error("Error closing WebSocket: " + error.message);
      }

      logger.info("Connection fully closed");
    };

    // Initialize Deepgram STT with retry logic
    const initSTT = () => {
      try {
        logger.debug("Initializing Deepgram STT connection");
        sttConnection = deepgram.listen.live({
          model: "nova-2",
          language: "en-US",
          smart_format: true,
          encoding: "mulaw",
          sample_rate: 8000,
          channels: 1,
          interim_results: false,
          endpointing: 300,
        });

        sttConnection.on(LiveTranscriptionEvents.Open, () => {
          logger.info("Deepgram connection established");
          resetActivityTimer();
        });

        sttConnection.on(LiveTranscriptionEvents.Close, (event) => {
          logger.info(`Deepgram connection closed: ${event.reason}`);
          safeClose();
        });

        sttConnection.on(LiveTranscriptionEvents.Error, (error) => {
          logger.error(`Deepgram error: ${error.message}`);
          safeClose();
        });

        sttConnection.on(LiveTranscriptionEvents.Transcript, async (data) => {
          try {
            resetActivityTimer();
            const text = data.channel.alternatives[0]?.transcript;
            if (!text?.trim()) {
              logger.debug("Received empty transcript");
              return;
            }

            logger.info(`STT Result: "${text}"`);

            // Process with Groq
            logger.debug("Sending to Groq...");
            const llmResponse = await axios.post(
              "https://api.groq.com/v1/chat/completions",
              {
                model: "mixtral-8x7b-32768",
                messages: [
                  { role: "system", content: SYSTEM_MESSAGE },
                  { role: "user", content: text },
                ],
                temperature: 0.7,
                max_tokens: 150,
              },
              {
                headers: {
                  Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                  "Content-Type": "application/json",
                },
                timeout: 5000, // 5-second timeout
              }
            );

            const responseText = llmResponse.data.choices[0]?.message?.content;
            if (!responseText) {
              logger.error("Empty response from Groq");
              return;
            }

            logger.info(`LLM Response: "${responseText}"`);

            // Convert response to speech
            logger.debug("Generating TTS...");
            const ttsResponse = await axios.post(
              "https://api.deepgram.com/v1/speak",
              {
                text: responseText,
                model: "aura-asteria-en",
                encoding: "linear16",
                container: "wav",
                sample_rate: 8000, // Match Telnyx requirements
              },
              {
                headers: {
                  Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
                  "Content-Type": "application/json",
                },
                responseType: "arraybuffer",
                timeout: 5000, // 5-second timeout
              }
            );

            // Send audio back to Telnyx
            if (connection.socket.readyState === WebSocket.OPEN) {
              connection.socket.send(Buffer.from(ttsResponse.data));
              logger.debug("Sent TTS audio to Telnyx");
            } else {
              logger.error("WebSocket closed before TTS could be sent");
            }
          } catch (error) {
            logger.error(`Processing error: ${error.message}`);
            if (error.response) {
              logger.debug(
                `API Error Details: ${JSON.stringify(error.response.data)}`
              );
            }
            safeClose();
          }
        });
      } catch (error) {
        logger.error(`STT Initialization failed: ${error.message}`);
        safeClose();
      }
    };

    // Handle Telnyx media
    connection.on("message", (message) => {
      console.log("============================");
      console.log("🚀 ~ connection.socket.on ~ message:", message);
      try {
        resetActivityTimer();
        const data = JSON.parse(message);
        console.log("🚀 ~ connection.socket.on ~ data:", data);
        if (data.event === "media") {
          logger.debug("Received audio chunk");
          if (!sttConnection || sttConnection.getReadyState() !== "open") {
            initSTT();
          }

          try {
            const audioChunk = Buffer.from(data.media.payload, "base64");
            sttConnection.send(audioChunk);
          } catch (error) {
            logger.error(`Error sending to Deepgram: ${error.message}`);
            safeClose();
          }
        }
      } catch (error) {
        logger.error(`Message handling error: ${error.message}`);
        safeClose();
      }
    });

    // Handle connection close
    connection.on("close", (code, reason) => {
      logger.info(`WebSocket closed (${code}) - ${reason.toString()}`);
      safeClose();
    });

    connection.on("error", (error) => {
      logger.error(`WebSocket error: ${error.message}`);
      safeClose();
    });

    // Send periodic keep-alive messages
    const keepAliveInterval = setInterval(() => {
      if (connection.readyState === WebSocket.OPEN) {
        try {
          connection.send(JSON.stringify({ event: "keepalive" }));
          logger.debug("Sent keep-alive message");
        } catch (error) {
          logger.error("Keep-alive failed: " + error.message);
        }
      }
    }, 15000); // Every 15 seconds

    // Cleanup intervals on close
    connection.on("close", () => {
      clearInterval(keepAliveInterval);
    });
  });
});
// ... existing code ...
