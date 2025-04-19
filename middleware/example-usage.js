// Example of using the authentication middleware in Fastify routes

import { authenticate, authorize } from "./auth.js";

/**
 * Example route registration with authentication middleware
 *
 * @param {Object} fastify - Fastify instance
 * @param {Object} options - Route options
 */
const exampleProtectedRoutes = async (fastify, options) => {
  // Create the authentication middleware handler
  const auth = authenticate(fastify);

  // Route that requires authentication
  fastify.get(
    "/api/protected",
    { preHandler: auth }, // Apply the authentication middleware
    async (request, reply) => {
      // At this point, request.user contains the authenticated user data
      return {
        message: "This is a protected route",
        user: request.user, // The user data extracted from the token
      };
    }
  );

  // Route that requires authentication and specific role
  fastify.get(
    "/api/admin-only",
    {
      preHandler: [
        auth, // First authenticate
        authorize("admin"), // Then check for admin role
      ],
    },
    async (request, reply) => {
      return {
        message: "This is an admin-only route",
        user: request.user,
      };
    }
  );

  // Multiple roles example
  fastify.get(
    "/api/managers-and-admins",
    {
      preHandler: [auth, authorize(["admin", "manager"])],
    },
    async (request, reply) => {
      return {
        message: "This route is accessible to both admins and managers",
        user: request.user,
      };
    }
  );
};

export default exampleProtectedRoutes;
