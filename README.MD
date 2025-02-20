# AI Batch Call System

A powerful backend system that enables launching multiple automated calls simultaneously using Telnyx Voice API and OpenAI's Realtime API. This system allows for scalable, AI-powered phone interactions in batch mode.

## Features

- Batch call processing: Launch multiple calls simultaneously
- Real-time AI interactions using OpenAI's Realtime API
- Voice communication handling with Telnyx
- Scalable WebSocket management for concurrent calls
- Environment-based configuration

## Prerequisites

- **Telnyx Account**: [Sign up here](https://telnyx.com/sign-up)
- **Telnyx Phone Number**: With voice capabilities
- **OpenAI Account**: With access to Realtime API
- **Node.js**: Version 18 or higher
- **pnpm**: Package manager

## Environment Setup

1. Clone the repository
2. Copy `.env.sample` to `.env` and fill in your credentials:
   ```
   OPENAI_API_KEY=your_openai_api_key
   PORT=8000
   TELNYX_API_KEY=your_telnyx_api_key
   PUBLIC_SERVER_URL=your_public_url
   ```

## Installation

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Start production server
pnpm start
```

## Tech Stack

- Node.js
- Fastify
- WebSocket (ws)
- Telnyx SDK
- OpenAI Realtime API

## Development

The application uses nodemon for development, which automatically restarts the server when files change.

## Production

For production deployment, ensure proper error handling and logging are configured, and use appropriate process managers like PM2 if needed.

## Security Notes

- Keep your API keys secure and never commit them to version control
- Implement rate limiting for the batch call endpoint
- Monitor call costs and implement necessary limits

## License

MIT
