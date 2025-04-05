import { google } from "googleapis";
import User from "../models/user.js";
import {
  bookCalendarEvent,
  getUpcomingEvents,
} from "../utils/googleCalendar.js";

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const googleCalenderRoutes = async (fastify, options) => {
  //save the tokens to the database
  fastify.post("/authorize", async (request, reply) => {
    try {
      const body = request.body;
      const { code, user: localUser } = JSON.parse(body);
      const { tokens } = await oauth2Client.getToken(code);
      console.log({ localUser });
      // save the tokens to the database
      const user = await User.findOne({ where: { id: localUser.id } });
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }
      user.google_oAuthAccessToken = tokens.access_token;
      user.google_oAuthRefreshToken = tokens.refresh_token;
      await user.save();
      return reply.send({ message: "Tokens saved successfully" });
    } catch (error) {
      console.log(error);
      return reply.status(500).send({ error: error.message });
    }
  });

  //get the events from the google calender
  fastify.get("/events", async (request, reply) => {
    console.log(request.query.userId);
    try {
      const events = await getUpcomingEvents(request.query.userId);
      return reply.send(events);
    } catch (error) {
      console.log(error);
      return reply.status(500).send({ error: error.message });
    }
  });

  //create an event in the google calender
  fastify.post("/events", async (request, reply) => {
    console.log(request.body);
    try {
      const response = await bookCalendarEvent(request.body);
      return reply.send(response);
    } catch (error) {
      console.log(error);
      return reply.status(500).send({ error: error.message });
    }
  });
};

export default googleCalenderRoutes;
