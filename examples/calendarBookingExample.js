import {
  bookCalendarEvent,
  getUpcomingEvents,
} from "../utils/googleCalendar.js";

/**
 * Example of how to use the calendar booking function
 *
 * This example shows how to:
 * 1. Book a new calendar event
 * 2. Retrieve upcoming events
 */

// Example function to book a new event
const bookAppointment = async (userId, appointmentDetails) => {
  try {
    // Prepare the event data
    const eventData = {
      user: { id: userId },
      summary: appointmentDetails.title,
      description: appointmentDetails.description,
      location: appointmentDetails.location || "Virtual Meeting",
      startTime: appointmentDetails.startTime,
      endTime: appointmentDetails.endTime,
      colorId: appointmentDetails.colorId || "7", // Default blue color
    };

    // Book the calendar event
    const response = await bookCalendarEvent(eventData);

    console.log("Event created successfully!");
    console.log("Event ID:", response.data.id);
    console.log("Event link:", response.data.htmlLink);

    return response.data;
  } catch (error) {
    console.error("Failed to book appointment:", error.message);
    throw error;
  }
};

// Example function to view upcoming events
const viewUpcomingAppointments = async (userId) => {
  try {
    const events = await getUpcomingEvents(userId, 5); // Get the next 5 events

    console.log(`Found ${events.length} upcoming events:`);

    events.forEach((event, index) => {
      const startDate = new Date(event.start.dateTime || event.start.date);
      console.log(
        `${index + 1}. ${event.summary} - ${startDate.toLocaleString()}`
      );
    });

    return events;
  } catch (error) {
    console.error("Failed to retrieve upcoming events:", error.message);
    throw error;
  }
};

// Example usage
const exampleUsage = async () => {
  // Replace with a real user ID from your database
  const userId = "user-id-from-database";

  // Example appointment details
  const appointment = {
    title: "Client Meeting",
    description: "Discussion about new project requirements",
    location: "Zoom Meeting",
    startTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
    endTime: new Date(Date.now() + 25 * 60 * 60 * 1000), // Tomorrow + 1 hour
  };

  try {
    // Book the appointment
    await bookAppointment(userId, appointment);

    // View upcoming appointments
    await viewUpcomingAppointments(userId);
  } catch (error) {
    console.error("Error in example usage:", error);
  }
};

// Uncomment to run the example
// exampleUsage();

export { bookAppointment, viewUpcomingAppointments };
