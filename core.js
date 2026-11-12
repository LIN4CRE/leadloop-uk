export {
  DB_NAME,
  DB_VERSION,
  CACHE_PREFIX,
  STAGES,
  WON_STAGES,
  CLOSED_STAGES,
  ACTIVE_STAGES,
  QUOTE_STATUSES,
  LINE_CATEGORIES,
  REPEAT_INTERVALS,
  PAYMENT_STATUSES,
  TRADE_CATEGORIES,
  DEFAULT_TEMPLATES,
  DEFAULT_SETTINGS,
  ALLOWED_SETTING_KEYS,
} from "./src/constants.js";

export {
  localDateString,
  validDate,
  addDays,
  formatDisplayDate,
  formatDateTime,
  daysBetween,
  round2,
  normalizeUKPhone,
  normalizeUKPostcode,
  normalizeEmail,
  normalizeNameKey,
  esc,
  money,
  createId,
  newQuoteReference,
  nextRevisionReference,
} from "./src/utils.js";

export {
  calculateQuote,
  calculateDetailedQuote,
  quoteTotal,
  validQuoteObject,
  buildQuoteRecord,
} from "./src/quotes.js";

export {
  daysInMonth,
  extractDayOfMonth,
  advanceRepeat,
  advanceRepeatDate,
  advanceDate,
  nextRepeatDate,
  calculateNextRepeatOccurrence,
  buildCompletedVisit,
} from "./src/repeat.js";

export {
  isFollowUpDue,
  isFollowUpOverdue,
  isRepeatDue,
  isNeedsFollowUpAttention,
  filterLeads,
  calculateDashboard,
} from "./src/analytics.js";

export {
  parseCustomTemplates,
  getAllTemplates,
  renderMessageTemplate,
} from "./src/templates.js";

export {
  escapeCsvCell,
  toCsvString,
  generateEnquiriesCsv,
  generateCustomersCsv,
} from "./src/csv.js";

export {
  normalizeInterval,
  normalizeStage,
  migrateQuote,
  migrateLead,
  migrateSettings,
  findUnambiguousCustomerMatch,
  findPotentialDuplicates,
  buildCustomerFromLead,
  linkLeadsToCustomers,
  deriveQuotesAndActivitiesFromLeads,
  validLeadRecord,
  validCustomerRecord,
  validVisitRecord,
  validActivityRecord,
  validateBackup,
} from "./src/migration.js";
