# Authentication Middleware for Fastify

This directory contains middleware for authentication and authorization in your Fastify application.

## Features

- JWT token verification
- User data extraction from token to `request.user`
- Role-based authorization

## Usage

### Basic Authentication

To protect a route with authentication:

```javascript
import { authenticate } from "./middleware/auth.js";

// In your route file
export default async function (fastify, options) {
  const auth = authenticate(fastify);

  // Protected route
  fastify.get(
    "/protected-route",
    { preHandler: auth },
    async (request, reply) => {
      // Access the authenticated user
      const user = request.user;

      return { message: "You are authenticated!", user };
    }
  );
}
```

### Role-Based Authorization

To restrict access based on user roles:

```javascript
import { authenticate, authorize } from "./middleware/auth.js";

export default async function (fastify, options) {
  const auth = authenticate(fastify);

  // Admin-only route
  fastify.get(
    "/admin-dashboard",
    {
      preHandler: [
        auth, // First authenticate
        authorize("admin"), // Then check role
      ],
    },
    async (request, reply) => {
      return { message: "Admin dashboard data" };
    }
  );

  // Multiple roles
  fastify.get(
    "/managers-area",
    {
      preHandler: [auth, authorize(["admin", "manager"])],
    },
    async (request, reply) => {
      return { message: "Manager area data" };
    }
  );
}
```

## Token Format

The middleware expects JWT tokens in the following format in the request headers:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Or simply:

```
Authorization: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Configuration

The middleware uses `process.env.JWT_SECRET` for token verification. Make sure this is set in your environment variables.

## Error Responses

The middleware will respond with appropriate HTTP status codes:

- `401 Unauthorized`: Missing or invalid token
- `403 Forbidden`: User doesn't have the required role
- `500 Internal Server Error`: Server-side error during authentication
