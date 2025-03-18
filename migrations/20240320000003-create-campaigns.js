export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable("Campaigns", {
    id: {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    status: {
      type: Sequelize.ENUM("pending", "in_progress", "paused", "completed"),
      defaultValue: "pending",
    },
    last_status: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    all_numbers: {
      type: Sequelize.JSON,
      defaultValue: [],
      allowNull: false,
    },
    numbers_to_call: {
      type: Sequelize.JSON,
      defaultValue: [],
      allowNull: false,
    },
    telnyx_numbers: {
      type: Sequelize.JSON,
      defaultValue: [],
      allowNull: false,
    },
    system_message: {
      type: Sequelize.TEXT,
      allowNull: false,
    },
    completed_calls: {
      type: Sequelize.INTEGER,
      defaultValue: 0,
    },
    failed_calls: {
      type: Sequelize.INTEGER,
      defaultValue: 0,
    },
    total_duration: {
      type: Sequelize.INTEGER,
      defaultValue: 0,
    },
    total_cost: {
      type: Sequelize.DECIMAL(10, 4),
      defaultValue: 0,
    },
    createdAt: {
      type: Sequelize.DATE,
      allowNull: false,
    },
    updatedAt: {
      type: Sequelize.DATE,
      allowNull: false,
    },
  });
}

export async function down(queryInterface, Sequelize) {
  await queryInterface.dropTable("Campaigns");
}
