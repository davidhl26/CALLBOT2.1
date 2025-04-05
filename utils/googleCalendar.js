import { google } from "googleapis";
import User from "../models/user.js";

// Create OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

/**
 * Book an event in Google Calendar
 * @param {Object} eventData - Event data to be inserted
 * @param {Object} eventData.user_id - User object containing ID
 * @param {string} eventData.summary - Event title/summary
 * @param {string} eventData.description - Event description
 * @param {string} eventData.location - Event location
 * @param {string|Date} eventData.startTime - Event start time
 * @param {string|Date} eventData.endTime - Event end time
 * @param {string} [eventData.colorId="7"] - Event color (optional)
 * @returns {Promise<Object>} Response from Google Calendar API
 * @throws {Error} If user not found or calendar operation fails
 */
export const bookCalendarEvent = async (eventData) => {
  console.log(`[Google Calendar] eventData: ${eventData.user_id}`);
  try {
    // Find user and set credentials
    const user = await User.findOne({ where: { id: +eventData.user_id } });
    if (!user) {
      throw new Error("User not found");
    }

    // Set the refresh token for authentication
    oauth2Client.setCredentials({
      refresh_token: user.google_oAuthRefreshToken,
    });

    // Initialize calendar service
    const calendar = google.calendar("v3");

    // Create the event
    const response = await calendar.events.insert({
      auth: oauth2Client,
      calendarId: "primary",
      requestBody: {
        summary: eventData.summary,
        description: eventData.description,
        location: eventData.location,
        colorId: eventData.colorId || "7",
        start: {
          dateTime: new Date(eventData.startTime),
        },
        end: {
          dateTime: new Date(eventData.endTime),
        },
      },
    });

    return response.data;
  } catch (error) {
    console.error("Failed to book calendar event:", error);
    throw error;
  }
};

/**
 * Fetch upcoming events from Google Calendar
 * @param {string} userId - User ID to fetch events for
 * @param {number} [maxResults=10] - Maximum number of events to return
 * @returns {Promise<Array>} List of calendar events
 * @throws {Error} If user not found or calendar operation fails
 */
export const getUpcomingEvents = async (userId, maxResults = 10) => {
  try {
    const user = await User.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error("User not found");
    }

    oauth2Client.setCredentials({
      refresh_token: user.google_oAuthRefreshToken,
    });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
    });

    return response.data.items;
  } catch (error) {
    console.error("Failed to fetch upcoming events:", error);
    throw error;
  }
};
