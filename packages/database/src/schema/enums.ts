/**
 * Postgres enums, built from the domain tuples so the database and the application can
 * never disagree about what a valid value is. Adding a member means editing
 * `@vehicle-os/domain` and generating a migration — there is no second list to forget.
 */

import { pgEnum } from 'drizzle-orm/pg-core';
import {
  ACCOUNT_KINDS,
  CONDITION_CATEGORIES,
  COST_REPORTING_MODES,
  DOCUMENT_TYPES,
  EVENT_TYPES,
  EXPENSE_CATEGORIES,
  FUEL_TYPES,
  GARAGE_ROLES,
  IDEA_STATUSES,
  INCOME_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  PLAN_TIERS,
  RECORD_SOURCES,
  SHARE_SCOPES,
  SUBSCRIPTION_STATUSES,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TRIP_PURPOSES,
  VALUATION_SOURCES,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
} from '@vehicle-os/domain';

export const vehicleTypeEnum = pgEnum('vehicle_type', VEHICLE_TYPES);
export const vehicleStatusEnum = pgEnum('vehicle_status', VEHICLE_STATUSES);
export const garageRoleEnum = pgEnum('garage_role', GARAGE_ROLES);
export const eventTypeEnum = pgEnum('event_type', EVENT_TYPES);
export const recordSourceEnum = pgEnum('record_source', RECORD_SOURCES);
export const taskStatusEnum = pgEnum('task_status', TASK_STATUSES);
export const taskPriorityEnum = pgEnum('task_priority', TASK_PRIORITIES);
export const taskCategoryEnum = pgEnum('task_category', TASK_CATEGORIES);
export const ideaStatusEnum = pgEnum('idea_status', IDEA_STATUSES);
export const expenseCategoryEnum = pgEnum('expense_category', EXPENSE_CATEGORIES);
export const incomeCategoryEnum = pgEnum('income_category', INCOME_CATEGORIES);
export const fuelTypeEnum = pgEnum('fuel_type', FUEL_TYPES);
export const documentTypeEnum = pgEnum('document_type', DOCUMENT_TYPES);
export const conditionCategoryEnum = pgEnum('condition_category', CONDITION_CATEGORIES);
export const valuationSourceEnum = pgEnum('valuation_source', VALUATION_SOURCES);
export const shareScopeEnum = pgEnum('share_scope', SHARE_SCOPES);
export const notificationChannelEnum = pgEnum('notification_channel', NOTIFICATION_CHANNELS);
export const notificationTypeEnum = pgEnum('notification_type', NOTIFICATION_TYPES);
export const tripPurposeEnum = pgEnum('trip_purpose', TRIP_PURPOSES);
export const costReportingModeEnum = pgEnum('cost_reporting_mode', COST_REPORTING_MODES);
export const accountKindEnum = pgEnum('account_kind', ACCOUNT_KINDS);
export const planTierEnum = pgEnum('plan_tier', PLAN_TIERS);
export const subscriptionStatusEnum = pgEnum('subscription_status', SUBSCRIPTION_STATUSES);
