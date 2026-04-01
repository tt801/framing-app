export type HelpArea =
  | "dashboard"
  | "app"
  | "customers"
  | "quotes"
  | "invoices"
  | "jobs"
  | "calendar"
  | "marketing"
  | "stock"
  | "admin"
  | "billing"
  | "integrations";

export type HelpEntry = {
  question: string;
  answer: string;
  keywords: string[];
};

export type HelpSection = {
  area: HelpArea;
  title: string;
  summary: string;
  quickPrompts: string[];
  entries: HelpEntry[];
};

const synonymMap: Record<string, string[]> = {
  add: ["new", "create", "start", "make"],
  admin: ["settings", "setup", "configuration"],
  billing: ["subscription", "plan", "payment", "stripe"],
  calendar: ["schedule", "scheduled", "planner"],
  campaign: ["marketing", "broadcast", "outreach"],
  connect: ["link", "setup", "configure", "integrate"],
  customer: ["client", "buyer"],
  invoice: ["bill", "payment"],
  job: ["order", "work", "production"],
  quote: ["estimate", "proposal"],
  send: ["share", "email", "message"],
  stock: ["inventory", "catalogue", "catalog"],
  user: ["staff", "team", "member"],
  visualizer: ["mockup", "design", "preview", "room"],
  whatsapp: ["twilio", "message"],
};

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "do",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "me",
  "my",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "where",
  "with",
]);

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(value: string) {
  const tokens = normalizeText(value)
    .split(" ")
    .filter((token) => token && !stopWords.has(token));

  const expanded = new Set<string>();
  for (const token of tokens) {
    expanded.add(token);
    for (const [root, synonyms] of Object.entries(synonymMap)) {
      if (token === root || synonyms.includes(token)) {
        expanded.add(root);
        for (const synonym of synonyms) expanded.add(synonym);
      }
    }
  }

  return Array.from(expanded);
}

function makeEntry(question: string, answer: string, keywords: string[]): HelpEntry {
  return { question, answer, keywords };
}

export const helpSections: Record<HelpArea, HelpSection> = {
  dashboard: {
    area: "dashboard",
    title: "Dashboard",
    summary: "Overview of your business, priorities, and shortcuts into the main workflow areas.",
    quickPrompts: [
      "What can I do from the dashboard?",
      "Where are my integrations?",
      "How do I get to billing?",
      "What should I check first each day?",
    ],
    entries: [
      makeEntry("What can I do from the dashboard?", "Use Dashboard as the main starting point for the day. It gives you quick access into customers, quotes, invoices, jobs, calendar, stock, marketing, billing, and admin.", ["dashboard", "overview", "home", "start", "summary"]),
      makeEntry("What should I check first each day?", "Start with Dashboard for the overview, then move into Jobs for production work, Calendar for scheduled items, and Quotes or Invoices for anything waiting on customer or payment action.", ["today", "daily", "check first", "morning", "priorities"]),
      makeEntry("Where are my integrations?", "Open Admin and go to Integrations. Connected apps such as WhatsApp, Mailchimp, Outlook, QuickBooks, and Xero live there now.", ["integration", "connected apps", "mailchimp", "outlook", "whatsapp", "quickbooks", "xero"]),
      makeEntry("How do I get to billing?", "Use the Billing page for subscription status, upgrades, and Stripe management. Admin > Integrations also shows a billing overview and a shortcut into the Stripe portal.", ["billing", "subscription", "stripe", "founder", "upgrade"]),
      makeEntry("How do I create something quickly?", "Use the global create button from the app header to jump straight into a new customer, quote, invoice, or job without leaving your current area.", ["create", "quick create", "new record", "new item", "header"]),
    ],
  },
  app: {
    area: "app",
    title: "Visualizer",
    summary: "Design mockups, preview framing choices, and prepare work for quotes or production.",
    quickPrompts: [
      "How do I start a visual mockup?",
      "How do I add a design to jobs?",
      "Can I save a design?",
      "How do I change the room backdrop?",
    ],
    entries: [
      makeEntry("How do I start a visual mockup?", "Open App to build a room or artwork mockup, then choose frame, mount, and presentation options so you can preview the finished look before quoting or producing it.", ["visualizer", "mockup", "room", "frame preview", "start"]),
      makeEntry("How do I add a design to jobs?", "Build the design in the visualizer first, then move it into the workflow when you are ready to quote, invoice, or produce it.", ["add design", "jobs", "visualizer", "workflow", "quote"]),
      makeEntry("Can I save a design?", "Yes. Save the work once the framing setup looks right so you can come back to it later or reuse it when preparing a quote or job.", ["save", "saved design", "preset", "favorite", "reuse"]),
      makeEntry("How do I change the room backdrop?", "Use the room or backdrop controls inside the visualizer to swap the wall or scene so customers can preview the design in a different environment.", ["backdrop", "room", "wall", "scene", "background"]),
      makeEntry("How do I show a customer a preview?", "Use the visualizer preview as the design reference while pricing or discussing options. Once the design is agreed, move it into the quote or job workflow.", ["preview", "show customer", "presentation", "design approval"]),
    ],
  },
  customers: {
    area: "customers",
    title: "Customers",
    summary: "Create and maintain customer records, contact details, history, and linked commercial activity.",
    quickPrompts: [
      "How do I add a new customer?",
      "How do I edit customer details?",
      "Where can I export customers?",
      "How do I find an existing customer?",
    ],
    entries: [
      makeEntry("How do I add a new customer?", "Use New customer in Customers. A blank customer is created and selected immediately so you can complete the details panel on the right.", ["customer", "new customer", "add customer", "create customer"]),
      makeEntry("How do I edit customer details?", "Select a customer in the left list, then update their details in the right-hand panel and save the record there.", ["edit customer", "details", "save customer", "customer form"]),
      makeEntry("Where can I export customers?", "Use the export customers control on the Customers page to download the currently filtered list.", ["export customers", "csv", "download customers"]),
      makeEntry("How do I find an existing customer?", "Use the customer search and filters on the Customers page. Once you select a customer, their details open in the right-hand panel.", ["find customer", "search customer", "filter customer", "existing customer"]),
      makeEntry("How do quotes or invoices link to customers?", "Customer records are the base for quoting and invoicing. Once selected on a quote or invoice, that work stays tied back to the customer history.", ["link customer", "customer history", "quotes", "invoices"]),
    ],
  },
  quotes: {
    area: "quotes",
    title: "Quotes",
    summary: "Create, manage, send, and progress quotes through to accepted work or invoice conversion.",
    quickPrompts: [
      "How do I create a new quote?",
      "How do I turn a quote into an invoice?",
      "How do I send a quote?",
      "How do I update quote status?",
    ],
    entries: [
      makeEntry("How do I create a new quote?", "Use New quote on the Quotes page or the global create button while you are in Quotes. It creates the quote in place and selects it immediately.", ["new quote", "create quote", "add quote"]),
      makeEntry("How do I turn a quote into an invoice?", "Open an existing quote and use Create Invoice when you are ready to convert accepted work into an invoice.", ["quote to invoice", "create invoice", "convert quote"]),
      makeEntry("How do I send a quote?", "Open the quote, use the send or customer communication actions, and then mark the quote as Sent once it has gone out.", ["send quote", "email quote", "whatsapp quote", "mark sent"]),
      makeEntry("How do I update quote status?", "Use the quote status field on the selected quote to track draft, sent, accepted, or other workflow states as the quote progresses.", ["quote status", "accepted", "draft", "sent", "won"]),
      makeEntry("Can I adjust pricing or tax on a quote?", "Yes. Open the quote details and update the line items, pricing values, and tax details before sending it to the customer.", ["price quote", "discount", "tax", "quote total", "line items"]),
    ],
  },
  invoices: {
    area: "invoices",
    title: "Invoices",
    summary: "Create invoices, track status and payments, and manage billing documents.",
    quickPrompts: [
      "How do I create a new invoice?",
      "How do I record a payment?",
      "How do I export an invoice?",
      "How do I chase unpaid invoices?",
    ],
    entries: [
      makeEntry("How do I create a new invoice?", "Use New invoice on the Invoices page. A blank invoice is created and selected so you can complete customer, pricing, and payment details.", ["new invoice", "create invoice", "add invoice"]),
      makeEntry("How do I record a payment?", "Open the invoice you want to update, then use the payment section on that invoice to record amounts received and keep the status accurate.", ["payment", "record payment", "invoice payment", "paid"]),
      makeEntry("How do I export an invoice?", "Open the invoice details and use the PDF or export action to generate the invoice document.", ["invoice pdf", "export invoice", "download invoice"]),
      makeEntry("How do I chase unpaid invoices?", "Use invoice status and communication actions to follow up with customers whose invoices are still outstanding, then update the record once payment arrives.", ["unpaid", "overdue", "reminder", "chase payment", "outstanding"]),
      makeEntry("Can invoices come from quotes?", "Yes. Start from the accepted quote and use Create Invoice so the invoice is created from the quote workflow rather than starting from scratch.", ["invoice from quote", "convert accepted quote", "quote invoice"]),
    ],
  },
  jobs: {
    area: "jobs",
    title: "Jobs",
    summary: "Track production work, deadlines, checklists, and customer completion communications.",
    quickPrompts: [
      "How do I create a new job?",
      "How do I send a ready message?",
      "Where do I edit default job steps?",
      "How do I assign work?",
    ],
    entries: [
      makeEntry("How do I create a new job?", "Use New job on the Jobs page. A blank job is created and selected immediately so you can fill in the details panel.", ["new job", "create job", "add job"]),
      makeEntry("How do I send a ready message?", "When a job is ready, open it in Jobs and use the customer communication actions to send the ready notification by email or WhatsApp.", ["ready message", "job ready", "whatsapp", "email customer"]),
      makeEntry("Where do I edit default job steps?", "Go to Admin > Jobs to manage the default job checklist and ready-message template that new jobs inherit.", ["job defaults", "checklist", "admin jobs", "ready template"]),
      makeEntry("How do I assign work?", "Open the job and use the assignment fields to set responsibility for the work. The Users setup in Admin feeds local assignment options used across the workspace.", ["assign", "staff", "team", "owner", "workshop", "responsibility"]),
      makeEntry("How do I track job progress?", "Use the job checklist, status, and dates to keep production moving and to see what is waiting, in progress, or ready for collection.", ["progress", "status", "production", "checklist", "ready"]),
    ],
  },
  calendar: {
    area: "calendar",
    title: "Calendar",
    summary: "Schedule and review work in a date-based view linked back to jobs and assignments.",
    quickPrompts: [
      "How do I link calendar events to jobs?",
      "How do I find a scheduled job?",
      "Can I filter by staff?",
      "How do I plan the week?",
    ],
    entries: [
      makeEntry("How do I link calendar events to jobs?", "Use Calendar to work with scheduled job items, then jump back into the linked record when you need to update production details.", ["calendar", "event", "link job", "schedule"]),
      makeEntry("How do I find a scheduled job?", "Select the event in Calendar and use the linked job navigation to open the related record in Jobs.", ["scheduled job", "calendar job", "open job"]),
      makeEntry("Can I filter by staff?", "Yes. Use the assignment or staff filters in Calendar to focus on one person or area of responsibility at a time.", ["staff filter", "assigned to", "team filter", "calendar users"]),
      makeEntry("How do I plan the week?", "Use Calendar as the planning view for deadlines, workshop loading, and scheduled fitting or collection work, then jump back into Jobs for detailed updates.", ["week planning", "planner", "deadlines", "schedule week"]),
      makeEntry("What does Calendar connect to?", "Calendar works with job scheduling so planned work can be viewed by date and followed back into the underlying job record.", ["calendar connect", "jobs", "linked records"]),
    ],
  },
  marketing: {
    area: "marketing",
    title: "Marketing",
    summary: "Build campaigns, choose audiences, and manage customer outreach tools and automations.",
    quickPrompts: [
      "How do I send a campaign?",
      "Where do I connect Mailchimp?",
      "How do I choose recipients?",
      "Can I automate follow-ups?",
    ],
    entries: [
      makeEntry("How do I send a campaign?", "Use Marketing to build your campaign, choose the audience, review the content, and then trigger the send action from there.", ["campaign", "send campaign", "marketing"]),
      makeEntry("Where do I connect Mailchimp?", "Open Admin > Integrations. Mailchimp credentials are stored there alongside your other connected apps.", ["mailchimp", "integrations", "connected apps"]),
      makeEntry("How do I choose recipients?", "In Marketing, use the audience controls to target all customers, filtered groups, or a custom list of selected recipients.", ["recipients", "audience", "segment", "customers"]),
      makeEntry("Can I automate follow-ups?", "Yes. Automations are intended for recurring marketing and customer follow-up actions such as quote follow-ups or review requests once the relevant integrations are connected.", ["automate", "follow up", "review request", "automation", "quote followup"]),
      makeEntry("What does Marketing depend on?", "Marketing works best once customer data is clean and integrations such as Mailchimp or messaging tools are connected in Admin > Integrations.", ["depends on", "requirements", "mailchimp", "data"]),
    ],
  },
  stock: {
    area: "stock",
    title: "Stock",
    summary: "Monitor stock levels and handle day-to-day inventory updates, with catalog setup managed in Admin.",
    quickPrompts: [
      "How do I manage stock?",
      "Where do I edit catalog pricing?",
      "How do I check low stock?",
      "Where do frames and mats live?",
    ],
    entries: [
      makeEntry("How do I manage stock?", "Use Stock for everyday inventory management. That is where you work with stock records and operational stock updates.", ["stock", "inventory", "manage stock"]),
      makeEntry("Where do I edit catalog pricing?", "Use Admin for catalog setup and pricing such as frames, mats, glazing, printing materials, and backer boards.", ["catalog", "pricing", "frames", "mats", "glazing", "backers"]),
      makeEntry("How do I check low stock?", "Use the Stock area to review current quantities and identify items that need replenishment before they affect production.", ["low stock", "reorder", "stock level", "quantity"]),
      makeEntry("Where do frames and mats live?", "Frames, mats, glazing, printing materials, and backer boards are managed from Admin, while Stock handles the day-to-day inventory side.", ["frames", "mats", "glazing", "backers", "catalog setup"]),
      makeEntry("Can I update stock after a job?", "Yes. Stock is where operational inventory updates should be recorded so usage stays aligned with current availability.", ["adjust stock", "stock after job", "usage", "inventory update"]),
    ],
  },
  admin: {
    area: "admin",
    title: "Admin",
    summary: "Control centre for company settings, catalog setup, integrations, billing visibility, users, and help coverage.",
    quickPrompts: [
      "Where are connected apps?",
      "How do I manage billing?",
      "Where is user management?",
      "Where do I update company settings?",
    ],
    entries: [
      makeEntry("Where are connected apps?", "Go to Admin > Integrations. WhatsApp, Mailchimp, Outlook, QuickBooks, Xero credentials, and the billing overview are managed there.", ["connected apps", "integrations", "mailchimp", "outlook", "twilio", "whatsapp", "quickbooks", "xero"]),
      makeEntry("How do I manage billing?", "Use the Billing page for plan and subscription management. Admin > Integrations also includes a billing overview and Stripe portal access.", ["billing", "subscription", "stripe", "billing overview"]),
      makeEntry("Where is user management?", "Open Admin > Users. That section is now the first-pass workspace user manager for local team members, roles, colors, and active status.", ["users", "roles", "team", "admin users", "staff"]),
      makeEntry("Where do I update company settings?", "Use the company-related tabs in Admin for workspace settings, catalog setup, and operational defaults that apply across the system.", ["company settings", "workspace settings", "admin setup"]),
      makeEntry("Where do I manage help assistant content?", "Open Admin > Help assistant to review current coverage. Content is still code-based for now, but the Admin area is the intended long-term home for managing it.", ["help assistant", "help content", "assistant admin", "knowledge base"]),
    ],
  },
  billing: {
    area: "billing",
    title: "Billing",
    summary: "Subscription plans, access status, Founder availability, and Stripe management.",
    quickPrompts: [
      "How do I upgrade my plan?",
      "How do I manage Stripe subscription?",
      "What happens if billing is overdue?",
      "What is the Founder plan?",
    ],
    entries: [
      makeEntry("How do I upgrade my plan?", "Open the Billing page to review available plans and start checkout for the subscription or Founder option that fits your account.", ["upgrade", "plan", "billing", "subscription"]),
      makeEntry("How do I manage Stripe subscription?", "Use the billing management controls to open the Stripe customer portal when your account is eligible for portal access.", ["stripe", "portal", "manage subscription", "billing"]),
      makeEntry("What happens if billing is overdue?", "Past-due and expired accounts are intended to become read-only rather than fully blocked, so data remains visible while billing is resolved.", ["overdue", "past due", "expired", "read only", "access"]),
      makeEntry("What is the Founder plan?", "The Founder option is treated as a one-time lifetime-style purchase and is tracked separately from recurring subscription plans.", ["founder", "lifetime", "one time", "one-off"]),
      makeEntry("Where do I see billing inside Admin?", "Admin > Integrations includes a billing overview, while the dedicated Billing page is where plan selection and management actions live.", ["billing admin", "billing overview", "integrations billing"]),
    ],
  },
  integrations: {
    area: "integrations",
    title: "Integrations",
    summary: "Connected apps, billing overview, and third-party service setup.",
    quickPrompts: [
      "Where do I connect WhatsApp?",
      "Where do I connect Outlook?",
      "Where do I connect Mailchimp?",
      "Where do QuickBooks and Xero live?",
    ],
    entries: [
      makeEntry("Where do I connect WhatsApp?", "Open Admin > Integrations and enter your Twilio WhatsApp credentials in the Connected apps section.", ["whatsapp", "twilio", "integrations", "connected apps"]),
      makeEntry("Where do I connect Outlook?", "Open Admin > Integrations and enter your Microsoft and Outlook details in the Connected apps section.", ["outlook", "microsoft", "email", "integrations"]),
      makeEntry("Where do I connect Mailchimp?", "Open Admin > Integrations and add your Mailchimp API key and server value in the Connected apps section.", ["mailchimp", "email marketing", "integrations"]),
      makeEntry("Where do QuickBooks and Xero live?", "QuickBooks and Xero connection and sync controls belong in Admin > Integrations alongside the other connected services.", ["quickbooks", "xero", "accounting", "sync", "integrations"]),
      makeEntry("Why is an integration not working?", "Start by checking the credentials in Admin > Integrations, then confirm the connected service account is active and the required keys or IDs were saved correctly.", ["integration not working", "broken integration", "credentials", "api key", "setup issue"]),
    ],
  },
};

export function getHelpSection(area: string): HelpSection {
  const key = (area in helpSections ? area : "dashboard") as HelpArea;
  return helpSections[key];
}

function scoreEntry(question: string, entry: HelpEntry, currentArea: HelpArea, sectionArea: HelpArea) {
  const normalizedQuestion = normalizeText(question);
  const questionTokens = tokenize(question);
  const entryTokens = tokenize(`${entry.question} ${entry.keywords.join(" ")}`);
  let score = 0;

  if (normalizedQuestion.includes(normalizeText(entry.question))) {
    score += 8;
  }

  for (const keyword of entry.keywords) {
    const normalizedKeyword = normalizeText(keyword);
    if (normalizedKeyword && normalizedQuestion.includes(normalizedKeyword)) {
      score += normalizedKeyword.includes(" ") ? 5 : 3;
    }
  }

  for (const token of questionTokens) {
    if (entryTokens.includes(token)) {
      score += 2;
    }
  }

  if (sectionArea === currentArea) {
    score += 2;
  }

  return score;
}

export function findBestHelpReply(question: string, area: string): string {
  const current = getHelpSection(area);
  const sections = [current, ...Object.values(helpSections).filter((section) => section.area !== current.area)];

  let bestEntry: HelpEntry | null = null;
  let bestScore = 0;
  let bestSection = current;

  for (const section of sections) {
    for (const entry of section.entries) {
      const score = scoreEntry(question, entry, current.area, section.area);
      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
        bestSection = section;
      }
    }
  }

  if (bestEntry && bestScore >= 4) {
    if (bestSection.area === current.area) {
      return bestEntry.answer;
    }

    return `${bestEntry.answer} If you are looking in the wrong place, try ${bestSection.title}.`;
  }

  const suggestions = [
    ...current.quickPrompts.slice(0, 2),
    ...Object.values(helpSections)
      .filter((section) => section.area !== current.area)
      .flatMap((section) => section.quickPrompts.slice(0, 1)),
  ].slice(0, 4);

  return `I do not have a precise answer for that yet. I can help with ${current.title.toLowerCase()} and related workflow questions. Try asking: ${suggestions.join(" | ")}.`;
}
