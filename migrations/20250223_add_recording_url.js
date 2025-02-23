export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("Calls", "recording_url", {
    type: Sequelize.TEXT,
    allowNull: true,
  });
}

export async function down(queryInterface, Sequelize) {
  await queryInterface.removeColumn("Calls", "recording_url");
}
