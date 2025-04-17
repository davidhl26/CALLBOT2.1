export async function up(queryInterface, Sequelize) {
  // Add the in_progress_numbers column if it doesn't exist
  await queryInterface.addColumn("Campaigns", "in_progress_numbers", {
    type: Sequelize.JSON,
    defaultValue: [],
    allowNull: false,
  });
}

export async function down(queryInterface, Sequelize) {
  // Remove the in_progress_numbers column
  await queryInterface.removeColumn("Campaigns", "in_progress_numbers");
}
