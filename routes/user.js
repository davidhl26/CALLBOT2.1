import User from "../models/user.js";
import jwt from "jsonwebtoken";

const userRoutes = async (fastify, options) => {
  // GET all users - for admin dashboard
  fastify.get("/api/user", async (request, reply) => {
    try {
      const users = await User.findAll({
        attributes: { exclude: ["password"] }
      });
      
      return users;
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ 
        message: "Failed to fetch users", 
        error: error.message 
      });
    }
  });

  // POST - register/signup a new user
  fastify.post("/api/user/signup", async (request, reply) => {
    try {
      const { name, email, password } = request.body;
      
      // Check if user already exists
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        return reply.code(400).send({ message: "Email already in use" });
      }
      
      // Create new user with status inactive by default
      const newUser = await User.create({
        name,
        email,
        password, // Password will be hashed by model hooks
        status: "Inactive" // Default status is inactive until approved by admin
      });
      
      // Return user without password
      const userWithoutPassword = {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        status: newUser.status,
        createdAt: newUser.createdAt
      };
      
      return reply.code(201).send({ 
        message: "Account created successfully. An administrator will activate your account.",
        user: userWithoutPassword
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ 
        message: "Failed to create account", 
        error: error.message 
      });
    }
  });

  // POST - login user
  fastify.post("/api/user/login", async (request, reply) => {
    try {
      const { email, password } = request.body;
      
      // Find the user
      const user = await User.findOne({ where: { email } });
      if (!user) {
        return reply.code(401).send({ message: "Invalid credentials" });
      }
      
      // Check password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return reply.code(401).send({ message: "Invalid credentials" });
      }
      
      // Check if user is active
      if (user.status !== "Active") {
        return reply.code(403).send({ 
          message: "Your account is not active. Please contact an administrator."
        });
      }
      
      // Generate JWT token
      const token = jwt.sign(
        { 
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role 
        },
        process.env.JWT_SECRET || "your-secret-key",
        { expiresIn: "24h" }
      );
      
      // Return user data and token
      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status
        },
        token
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ 
        message: "Login failed", 
        error: error.message 
      });
    }
  });

  // GET user by ID
  fastify.get("/api/user/:id", async (request, reply) => {
    try {
      const user = await User.findByPk(request.params.id, {
        attributes: { exclude: ["password"] }
      });
      
      if (!user) {
        return reply.code(404).send({ message: "User not found" });
      }
      
      return user;
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ 
        message: "Failed to fetch user", 
        error: error.message 
      });
    }
  });

  // PUT - update user
  fastify.put("/api/user/:id", async (request, reply) => {
    try {
      const { name, email, role, status } = request.body;
      const userId = request.params.id;
      
      // Find user
      const user = await User.findByPk(userId);
      if (!user) {
        return reply.code(404).send({ message: "User not found" });
      }
      
      // Update user fields
      await user.update({
        name: name || user.name,
        email: email || user.email,
        role: role || user.role,
        status: status || user.status
      });
      
      // Return user without password
      const userWithoutPassword = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        updatedAt: user.updatedAt
      };
      
      return { 
        message: "User updated successfully",
        user: userWithoutPassword
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ 
        message: "Failed to update user", 
        error: error.message 
      });
    }
  });

  // DELETE - delete user
  fastify.delete("/api/user/:id", async (request, reply) => {
    try {
      const userId = request.params.id;
      
      const user = await User.findByPk(userId);
      if (!user) {
        return reply.code(404).send({ message: "User not found" });
      }
      
      await user.destroy();
      return { message: "User deleted successfully" };
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ 
        message: "Failed to delete user", 
        error: error.message 
      });
    }
  });
};

export default userRoutes;