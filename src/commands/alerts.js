import { SUMMARY_TYPES } from './summary.js';
import { get_registered_client } from '../blackboard/methods.js';
import { spread_fields_over_embeds } from '../utils.js';

export const ALERTS_ACTIONS = {
    LIST: 'List all created alerts',
    CREATE: 'Create a new alert',
    DELETE: 'Delete an existing alert',
};

export const ALERTS_INTERVALS = {
    DAILY: 'Daily',
    WEEKLY: 'Weekly',
};

/**
 * Builds and returns the `alerts` command.
 * @param {import('discord.js').SlashCommandBuilder} builder
 * @returns {import('discord.js').SlashCommandBuilder}
 */
export function build_alerts_command(builder) {
    return builder
        .setName('alerts')
        .setDescription('Manage your automatic Blackboard summery alerts.')
        .addStringOption((option) =>
            option
                .setName('action')
                .setDescription(`Choose an action to perform for the alerts command. (Default: ${ALERTS_ACTIONS.LIST})`)
                .setRequired(true)
                .addChoices(
                    ...Object.keys(ALERTS_ACTIONS).map((key) => ({
                        name: ALERTS_ACTIONS[key],
                        value: key,
                    }))
                )
        )
        .addChannelOption((option) =>
            option
                .setName('channel')
                .setDescription('The channel to send the alerts to. (Required: Create & Delete)')
                .setRequired(false)
        )
        .addStringOption((option) =>
            option
                .setName('summary')
                .setDescription('Specify the summary type to receive alerts for. (Required: Create & Delete)')
                .setRequired(false)
                .addChoices(
                    ...Object.keys(SUMMARY_TYPES).map((key) => ({
                        name: SUMMARY_TYPES[key],
                        value: key,
                    }))
                )
        )
        .addStringOption((option) =>
            option
                .setName('interval')
                .setDescription(`Specify the interval at which to receive alerts. (Default: ${ALERTS_INTERVALS.DAILY})`)
                .setRequired(false)
                .addChoices(
                    ...Object.keys(ALERTS_INTERVALS).map((key) => ({
                        name: ALERTS_INTERVALS[key],
                        value: key,
                    }))
                )
        )
        .addNumberOption((option) =>
            option
                .setName('hour_of_day')
                .setDescription(
                    'Specify the hour of the day (24 Hour Format) to receive alerts. (Default: 8 aka. 8 AM)'
                )
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(23)
        )
        .addNumberOption((option) =>
            option
                .setName('max_courses_age')
                .setDescription(
                    'Maximum age in "number of months" to filter out past courses. (Default: 6 aka. 6 Months)'
                )
                .setMinValue(1)
                .setMaxValue(48)
                .setRequired(false)
        );
}

/**
 * Handles interactions for the `alerts` command.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<void>}
 */
export async function on_alerts_command(interaction) {
    // Retrieve all the options from the interaction with default values.
    const action = interaction.options.getString('action') || 'LIST';
    const summary = interaction.options.getString('summary');
    const channel = interaction.options.getChannel('channel');
    const interval = interaction.options.getString('interval') || 'DAILY';
    const hour_of_day = interaction.options.getNumber('hour_of_day') || 8;
    const max_courses_age = interaction.options.getNumber('max_courses_age') || 6;

    // Retrieve the client associated with the interaction
    const client = get_registered_client(interaction);
    if (!client) throw new Error('NO_CLIENT');

    // Determine if this action is a list action.
    if (ALERTS_ACTIONS[action] === ALERTS_ACTIONS.LIST) {
        // Retrieve a list of all alerts with potential summary and channel filter assertions.
        const fields = [];
        Object.keys(client.alerts).forEach((id, index) => {
            const alert = client.alerts[id];
            fields.push({
                name: `Alert #${index + 1}`,
                value: `This alert is scheduled to post a **${SUMMARY_TYPES[alert.summary]}** summary **${
                    ALERTS_INTERVALS[alert.interval]
                } @ ${alert.hour_of_day}:00** (24 Hour Format) to the <#${
                    alert.channel
                }> channel for courses from the last **${alert.max_courses_age}** month(s).`,
            });
        });

        // Send the list of alerts to the user.
        return interaction.safe_reply({
            ephemeral: true,
            embeds: spread_fields_over_embeds({
                title: 'Current Alerts',
                description: `You currently have **${fields.length}** active alert(s).`,
                fields,
            }),
        });
    }

    // Ensure that a summary was provided for the create and delete actions.
    if (!SUMMARY_TYPES[summary])
        return interaction.safe_reply({
            content: `Please provide a valid **summary** value. (One Of ${Object.values(SUMMARY_TYPES)
                .map((name) => `"${name}"`)
                .join(', ')})`,
            ephemeral: true,
        });

    // Ensure a valid channel was provided for the create and delete actions.
    if (!channel || !channel.isTextBased())
        return interaction.safe_reply({
            content: 'Please provide a valid text **channel**.',
            ephemeral: true,
        });

    // Determine if this action is a create action.
    if (ALERTS_ACTIONS[action] === ALERTS_ACTIONS.CREATE) {
        // Create the new alert based on user options.
        const created = client.deploy_alert({
            summary,
            channel: channel.id,
            guild: interaction.guildId,
            interval,
            hour_of_day,
            max_courses_age,
        });

        // Return a message to the user with a description of the created alert.
        return interaction.safe_reply({
            ephemeral: true,
            content: `Successfully **${created ? 'created a new' : 'updated an existing'}** alert for **${
                SUMMARY_TYPES[summary]
            }** that will be posted at **${hour_of_day}:00** (24 Hour Format) **${
                ALERTS_INTERVALS[interval]
            }** in the <#${channel.id}> channel.`,
        });
    } else {
        // Delete the alert based on user options.
        const deleted = client.delete_alert(channel.id, summary);

        // If we didn't delete an alert, return an error message.
        if (!deleted)
            return interaction.safe_reply({
                ephemeral: true,
                content: `No alert exists for **${SUMMARY_TYPES[summary]}** in the channel <#${channel.id}>.`,
            });

        // Return a message to the user with a description of the deleted alert.
        return interaction.safe_reply({
            ephemeral: true,
            content: `No longer sending **${SUMMARY_TYPES[summary]}** alerts in the <#${channel.id}> channel.`,
        });
    }
}
