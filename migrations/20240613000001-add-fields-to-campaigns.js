export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("Campaigns", "total_calls", {
    type: Sequelize.INTEGER,
    defaultValue: 0,
    comment: "Total number of calls in this campaign",
  });

  await queryInterface.addColumn("Campaigns", "first_message", {
    type: Sequelize.TEXT,
    allowNull: true,
  });

  await queryInterface.addColumn("Campaigns", "ai_provider", {
    type: Sequelize.STRING,
    defaultValue: "eleven_labs",
  });

  // Add validation to ai_provider using a CHECK constraint if the database supports it
  // Note: This won't work in all database types, but is supported in PostgreSQL
  try {
    await queryInterface.sequelize.query(`
      ALTER TABLE "Campaigns" 
      ADD CONSTRAINT check_ai_provider 
      CHECK (ai_provider IN ('eleven_labs', 'real-time-api', 'groq+deepgram'))
    `);
  } catch (error) {
    console.warn(
      "Could not add CHECK constraint for ai_provider:",
      error.message
    );
  }
}

export async function down(queryInterface, Sequelize) {
  await queryInterface.removeColumn("Campaigns", "total_calls");
  await queryInterface.removeColumn("Campaigns", "first_message");

  // First remove the constraint if it exists
  try {
    await queryInterface.sequelize.query(`
      ALTER TABLE "Campaigns" 
      DROP CONSTRAINT IF EXISTS check_ai_provider
    `);
  } catch (error) {
    console.warn(
      "Could not remove CHECK constraint for ai_provider:",
      error.message
    );
  }

  await queryInterface.removeColumn("Campaigns", "ai_provider");
}
