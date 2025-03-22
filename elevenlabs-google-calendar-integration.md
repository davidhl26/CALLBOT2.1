# ElevenLabs Function Calling with Google Calendar Integration (SaaS Platform)

## Overview

Multi-tenant SaaS platform allowing businesses to connect their Google Calendars to the ElevenLabs voice assistant for automated appointment scheduling.

## Implementation Roadmap

### 1. SaaS Platform Architecture

- User authentication system (signup/login)
- User dashboard for managing calendar settings
- Multi-tenant database design
- Role-based access control

### 2. Google Calendar OAuth Flow

- Implement OAuth 2.0 consent flow for each user
- Store refresh tokens securely per user
- Handle token refresh and expiration
- Allow users to disconnect/reconnect calendars

### 3. User Configuration Panel

- Calendar selection (if user has multiple calendars)
- Business hours configuration
- Appointment type management
- Voice assistant customization options
- Notification preferences

### 4. Define Function Schema for ElevenLabs

```javascript
const functionSchema = {
  name: "schedule_appointment",
  description: "Schedule an appointment in the business's Google Calendar",
  parameters: {
    type: "object",
    properties: {
      patient_name: {
        type: "string",
        description: "Full name of the patient/client",
      },
      appointment_type: {
        type: "string",
        description: "Type of appointment (defined by business)",
      },
      date: {
        type: "string",
        description: "Appointment date in YYYY-MM-DD format",
      },
      time: {
        type: "string",
        description: "Appointment time in HH:MM format (24-hour)",
      },
      phone: {
        type: "string",
        description: "Patient's contact phone number",
      },
      email: {
        type: "string",
        description: "Patient's email address for confirmation",
      },
      notes: {
        type: "string",
        description: "Any additional notes for the appointment",
      },
    },
    required: ["patient_name", "appointment_type", "date", "time"],
  },
};
```

### 5. Multi-Tenant Implementation

```javascript
// Update ElevenLabs initialization with tenant-specific configuration
const setupElevenLabs = async (tenantId) => {
  // Get tenant configuration from database
  const tenant = await getTenantConfig(tenantId);

  // Get tenant's Google Calendar credentials
  const googleAuth = await getGoogleAuthForTenant(tenantId);

  // Initialize ElevenLabs with tenant-specific settings
  const initialConfig = {
    type: "conversation_initiation_client_data",
    dynamic_variables: {
      tenant_id: tenantId,
      business_name: tenant.businessName,
      call_id: callSid || streamSid || "unknown",
    },
    conversation_config_override: {
      agent: {
        prompt: {
          prompt: tenant.systemMessage || DEFAULT_SYSTEM_MESSAGE,
        },
        first_message:
          tenant.firstMessage ||
          `Hello, this is ${tenant.businessName}. How can I help you today?`,
        tools: [functionSchema],
      },
    },
  };

  // Send to ElevenLabs
  elevenLabsWs.send(JSON.stringify(initialConfig));
};

// Multi-tenant appointment scheduling
async function scheduleAppointment(params, tenantId) {
  // Get tenant's Google Calendar client
  const calendar = await getGoogleCalendarClient(tenantId);

  // Get tenant's appointment settings
  const settings = await getTenantAppointmentSettings(tenantId);

  // Check if appointment slot is available according to tenant settings
  const isAvailable = await checkAvailabilityForTenant(
    tenantId,
    params.date,
    params.time,
    settings.appointmentDuration[params.appointment_type] || 60
  );

  if (!isAvailable) {
    return {
      success: false,
      message:
        "The requested time slot is not available. Please choose another time.",
    };
  }

  // Create appointment using tenant's calendar
  try {
    const appointment = await createCalendarEventForTenant(tenantId, {
      summary: `${params.appointment_type} - ${params.patient_name}`,
      description: `Patient: ${params.patient_name}\nPhone: ${
        params.phone
      }\nEmail: ${params.email}\nNotes: ${params.notes || "None"}`,
      start: `${params.date}T${params.time}:00`,
      duration: settings.appointmentDuration[params.appointment_type] || 60,
    });

    // Save in tenant's appointment records
    await saveTenantAppointment(tenantId, {
      patient_name: params.patient_name,
      phone: params.phone,
      email: params.email,
      appointment_type: params.appointment_type,
      date: params.date,
      time: params.time,
      calendar_event_id: appointment.id,
      notes: params.notes,
    });

    // Send confirmation if enabled in tenant settings
    if (settings.sendConfirmations) {
      await sendAppointmentConfirmation(tenantId, {
        to: params.email,
        appointment_type: params.appointment_type,
        date: params.date,
        time: params.time,
        business_name: settings.businessName,
      });
    }

    return {
      success: true,
      message: "Appointment scheduled successfully",
      appointment_id: appointment.id,
      appointment_time: `${params.date} at ${params.time}`,
    };
  } catch (error) {
    console.error(
      `Error scheduling appointment for tenant ${tenantId}:`,
      error
    );
    return {
      success: false,
      message: "Failed to schedule appointment due to a system error.",
    };
  }
}
```

### 6. Database Schema

```javascript
// User (SaaS tenant)
const userSchema = {
  id: "UUID",
  email: "String",
  password: "Hashed String",
  business_name: "String",
  subscription_plan: "String",
  subscription_status: "String",
  created_at: "Timestamp",
  updated_at: "Timestamp",
};

// Google Auth
const googleAuthSchema = {
  user_id: "UUID",
  access_token: "Encrypted String",
  refresh_token: "Encrypted String",
  expiry_date: "Timestamp",
  calendar_id: "String",
  created_at: "Timestamp",
  updated_at: "Timestamp",
};

// Business Hours
const businessHoursSchema = {
  user_id: "UUID",
  day_of_week: "Integer (0-6)",
  start_time: "String (HH:MM)",
  end_time: "String (HH:MM)",
  is_closed: "Boolean",
  created_at: "Timestamp",
  updated_at: "Timestamp",
};

// Appointment Types
const appointmentTypeSchema = {
  id: "UUID",
  user_id: "UUID",
  name: "String",
  duration: "Integer (minutes)",
  color: "String (hex)",
  description: "String",
  created_at: "Timestamp",
  updated_at: "Timestamp",
};

// Appointments
const appointmentSchema = {
  id: "UUID",
  user_id: "UUID",
  appointment_type_id: "UUID",
  patient_name: "String",
  patient_phone: "String",
  patient_email: "String",
  date: "Date",
  time: "String (HH:MM)",
  duration: "Integer (minutes)",
  notes: "String",
  calendar_event_id: "String",
  status: "String (confirmed, canceled, completed)",
  created_at: "Timestamp",
  updated_at: "Timestamp",
};
```

### 7. Tenant-Specific Voice Assistant Configuration

Update the system message to be customizable per tenant:

```javascript
// Template for tenant system message
const TENANT_SYSTEM_MESSAGE_TEMPLATE = `
You are a voice assistant for {{business_name}}.
When a caller wants to schedule an appointment:
1. Ask for their full name
2. Ask what type of appointment they need from these options: {{appointment_types}}
3. Ask for their preferred date and time (business hours: {{business_hours}})
4. Ask for their phone number and email
5. Use the schedule_appointment function to check availability and book the appointment
6. Confirm the details with the caller

Do not make up appointment availability - only confirm appointments after successful function calls.
{{custom_instructions}}
`;

// Generate tenant-specific system message
function generateTenantSystemMessage(tenant) {
  return TENANT_SYSTEM_MESSAGE_TEMPLATE.replace(
    "{{business_name}}",
    tenant.businessName
  )
    .replace(
      "{{appointment_types}}",
      tenant.appointmentTypes.map((t) => t.name).join(", ")
    )
    .replace("{{business_hours}}", formatBusinessHours(tenant.businessHours))
    .replace("{{custom_instructions}}", tenant.customInstructions || "");
}
```

## SaaS Platform Features

### User Dashboard

- Analytics on appointments booked
- Call recordings and transcripts
- Revenue and appointment statistics
- Voice assistant customization

### Billing and Subscription

- Tiered pricing plans
- Usage-based billing (call minutes, appointments booked)
- Payment processing integration
- Subscription management

### Integration Options

- Google Calendar (primary)
- Microsoft Outlook/365 (future)
- Zoom for video appointments (future)
- SMS reminders via Twilio
- Email notifications

## Implementation Phases

### Phase 1: Core Platform

1. User authentication and management
2. Google Calendar OAuth integration
3. Basic appointment scheduling
4. Voice assistant with ElevenLabs

### Phase 2: Enhanced Features

1. Customizable voice assistant
2. Multiple appointment types
3. Email/SMS notifications
4. Analytics dashboard

### Phase 3: Advanced Capabilities

1. Additional calendar integrations
2. Multi-location support
3. Staff/resource allocation
4. Advanced reporting
5. White-label options
