export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable("Calls", {
    id: {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    call_sid: {
      type: Sequelize.STRING,
      unique: true,
    },
    from_number: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    to_number: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    status: {
      type: Sequelize.STRING,
      defaultValue: "queued",
    },
    start_time: {
      type: Sequelize.DATE,
      defaultValue: Sequelize.NOW,
    },
    end_time: {
      type: Sequelize.DATE,
    },
    duration: {
      type: Sequelize.INTEGER,
    },
    cost: {
      type: Sequelize.DECIMAL(10, 4),
    },
    system_message: {
      type: Sequelize.TEXT,
    },
    recording_url: {
      type: Sequelize.TEXT,
    },
    campaign_id: {
      type: Sequelize.INTEGER,
      references: {
        model: "Campaigns",
        key: "id",
      },
    },
    contact_id: {
      type: Sequelize.UUID,
      references: {
        model: "Contacts",
        key: "id",
      },
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
  await queryInterface.dropTable("Calls");
}
