import jwt from "jsonwebtoken";

/**
 * Authentication middleware for Fastify
 *
 * Verifies the JWT token from the Authorization header
 * If valid, adds the decoded user data to request.user
 *
 * @param {Object} fastify - Fastify instance
 * @returns {Function} Fastify middleware function
 */
export const authenticate = (fastify) => {
  return async (request, reply) => {
    try {
      // Get the Authorization header
      const authHeader = request.headers.authorization;

      if (!authHeader) {
        return reply.code(401).send({ message: "Authentication required" });
      }

      // Extract the token (remove "Bearer " prefix if present)
      const token = authHeader.startsWith("Bearer ")
        ? authHeader.substring(7)
        : authHeader;

      if (!token) {
        return reply
          .code(401)
          .send({ message: "Authentication token is missing" });
      }

      try {
        // Verify the token using the JWT_SECRET
        const decodedToken = jwt.verify(
          token,
          process.env.JWT_SECRET || "your-secret-key"
        );

        // Add the user data to the request object
        request.user = decodedToken;
      } catch (error) {
        // Token verification failed
        if (error.name === "TokenExpiredError") {
          return reply
            .code(401)
            .send({ message: "Authentication token has expired" });
        }

        return reply
          .code(401)
          .send({ message: "Invalid authentication token" });
      }
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ message: "Authentication error" });
    }
  };
};

/**
 * Role-based authorization middleware
 *
 * Checks if the authenticated user has the required role
 *
 * @param {Array|String} roles - Required role(s) to access the route
 * @returns {Function} Fastify middleware function
 */
export const authorize = (roles) => {
  return async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ message: "Authentication required" });
    }

    // Convert roles to array if it's a string
    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    // Check if user role is in the allowed roles
    if (!allowedRoles.includes(request.user.role)) {
      return reply.code(403).send({
        message: "You do not have permission to access this resource",
      });
    }
  };
};

export default { authenticate, authorize };
