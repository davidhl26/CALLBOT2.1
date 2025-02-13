# OpenAI Twilio Call Bot

This project implements a voice call bot using Twilio and OpenAI's Realtime API. It allows users to have interactive voice conversations with an AI-powered assistant.

## Prerequisites

- Node.js (v18 or higher)
- pnpm or npm
- Twilio Account
- OpenAI API Key
- ngrok (for local testing)

## Installation

1. Clone the repository
2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Create a `.env` file in the root directory with the following variables:

   ```
   PORT=5050
   DOMAIN=your_domain (e.g., ngrok.io for local testing)
   OPENAI_API_KEY=your_openai_api_key
   TWILIO_ACCOUNT_SID=your_twilio_account_sid
   TWILIO_AUTH_TOKEN=your_twilio_auth_token
   TWILIO_PHONE_NUMBER=your_twilio_phone_number
   ```

## Running the Server

1. Start the server:

   ```bash
   pnpm start
   ```

   For development with auto-reload:

   ```bash
   pnpm dev
   ```

2. Start ngrok to expose your local server:

   ```bash
   ngrok http --url=your-ngrok-url.ngrok.io 5050
   ```

   Note: Save the HTTPS URL provided by ngrok (e.g., https://your-ngrok-url.ngrok.io)

## Twilio Configuration

1. Go to [Twilio Console](https://console.twilio.com)
2. Navigate to Phone Numbers → Manage → Active numbers
3. Click on your Twilio phone number
4. Under "Voice & Fax" section:

   - Set the webhook URL for "A Call Comes In" to:

     ```
     https://your-ngrok-url.ngrok.io/incoming-call
     ```

   - Set the webhook method to HTTP POST

## Testing with Dev Phone (Optional)

1. Install the [Twilio Dev Phone](https://www.twilio.com/docs/labs/dev-phone)
2. Log in to your Twilio account in the Dev Phone
3. Use the Dev Phone interface to make test calls to your Twilio number

## Making Test Calls

1. Call your Twilio phone number
2. The AI assistant will answer and engage in conversation
3. Speak naturally - the assistant will respond using OpenAI's Realtime API

## Important Notes

- Keep your `.env` file secure and never commit it to version control
- The ngrok URL changes every time you restart ngrok (unless you have a paid account)
- Update the Twilio webhook URL whenever your ngrok URL changes
- Monitor your OpenAI API usage to manage costs

## Troubleshooting

1. If calls aren't connecting:

   - Verify your Twilio webhook URL is correct
   - Check that ngrok is running
   - Ensure your server is running
   - Verify your environment variables

2. If the assistant isn't responding:
   - Check your OpenAI API key
   - Monitor the server logs for errors
   - Verify your internet connection

## License

MIT
