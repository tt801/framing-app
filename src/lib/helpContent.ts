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

export const helpSections: Record<HelpArea, HelpSection> = {
  dashboard: {
    area: "dashboard",
    title: "Dashboard",
    summary: "Overview of your framing business, key workflow areas, and next actions.",
    quickPrompts: [
      "What can I do from the dashboard?",
      "Where are my integrations?",
      "How do I get to billing?",
    ],
    entries: [
      {
        question: "What can I do from the dashboard?",
        answer:
          "Use Dashboard as your starting point for the day. It gives you a high-level view and quick paths into customers, quotes, invoices, jobs, calendar, stock, marketing, and admin.",
        keywords: ["dashboard", "overview", "home", "start", "summary"],
      },
      {
        question: "Where are my integrations?",
        answer:
          "Open Admin, then go to Integrations. Connected apps such as WhatsApp, Mailchimp, and Outlook credentials live there now.",
        keywords: ["integration", "connected apps", "mailchimp", "outlook", "whatsapp", "admin"],
      },
      {
        question: "How do I get to billing?",
        answer:
          "Use the Billing page for subscription status, upgrades, and Stripe management. Admin > Integrations also shows a billing overview and a shortcut into Stripe management.",
        keywords: ["billing", "subscription", "stripe", "founder", "upgrade"],
      },
    ],
  },
  app: {
    area: "app",
    title: "Visualizer",
    summary: "Design mockups, preview framing choices, and move work into quotes or jobs.",
    quickPrompts: [
      "How do I start a visual mockup?",
      "How do I add a design to jobs?",
    ],
    entries: [
      {
        question: "How do I start a visual mockup?",
        answer:
          "Open App to build a room or artwork mockup, choose frame and mat options, and preview the finished look before quoting or producing it.",
        keywords: ["visualizer", "mockup", "room", "frame preview", "start"],
      },
      {
        question: "How do I add a design to jobs?",
        answer:
          "Use the visualizer to build the design first, then move it into the operational workflow when you are ready to quote or produce it.",
        keywords: ["add design", "jobs", "visualizer", "workflow", "quote"],
      },
    ],
  },
  customers: {
    area: "customers",
    title: "Customers",
    summary: "Create and maintain customer records, contact details, history, and linked invoices.",
    quickPrompts: [
      "How do I add a new customer?",
      "How do I edit customer details?",
      "Where can I export customers?",
    ],
    entries: [
      {
        question: "How do I add a new customer?",
        answer:
          "Use New customer in Customers. A blank customer is created and selected immediately so you can complete the details panel on the right.",
        keywords: ["customer", "new customer", "add customer", "create customer"],
      },
      {
        question: "How do I edit customer details?",
        answer:
          "Select a customer in the left list, then update their details in the right-hand panel and save the record there.",
        keywords: ["edit customer", "details", "save customer", "customer form"],
      },
      {
        question: "Where can I export customers?",
        answer:
          "Use the export customers control on the Customers page to download the currently filtered list.",
        keywords: ["export customers", "csv", "download customers"],
      },
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
    ],
    entries: [
      {
        question: "How do I create a new quote?",
        answer:
          "Use New quote on the Quotes page or the global create button while you are in Quotes. It creates the quote in place and selects it immediately.",
        keywords: ["new quote", "create quote", "add quote"],
      },
      {
        question: "How do I turn a quote into an invoice?",
        answer:
          "Open an existing quote and use Create Invoice when you are ready to convert that accepted work into an invoice.",
        keywords: ["quote to invoice", "create invoice", "convert quote"],
      },
      {
        question: "How do I send a quote?",
        answer:
          "Open the quote, use the send or customer communication actions, and mark the quote as Sent once it has gone out.",
        keywords: ["send quote", "email quote", "whatsapp quote", "mark sent"],
      },
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
    ],
    entries: [
      {
        question: "How do I create a new invoice?",
        answer:
          "Use New invoice on the Invoices page. A blank invoice is created and selected so you can complete customer, pricing, and payment details.",
        keywords: ["new invoice", "create invoice", "add invoice"],
      },
      {
        question: "How do I record a payment?",
        answer:
          "Open the invoice you want to update, then use the payment section on that invoice to record amounts received and keep the status accurate.",
        keywords: ["payment", "record payment", "invoice payment", "paid"],
      },
      {
        question: "How do I export an invoice?",
        answer:
          "Open the invoice details and use the PDF or export action to generate the invoice document.",
        keywords: ["invoice pdf", "export invoice", "download invoice"],
      },
    ],
  },
  jobs: {
    area: "jobs",
    title: "Jobs",
    summary: "Track production work, deadlines, checklists, and completion communications.",
    quickPrompts: [
      "How do I create a new job?",
      "How do I send a ready message?",
      "Where do I edit default job steps?",
    ],
    entries: [
      {
        question: "How do I create a new job?",
        answer:
          "Use New job on the Jobs page. A blank job is created and selected immediately so you can fill in the details panel.",
        keywords: ["new job", "create job", "add job"],
      },
      {
        question: "How do I send a ready message?",
        answer:
          "When a job is ready, open it in Jobs and use the customer communication actions to send the ready notification by email or WhatsApp.",
        keywords: ["ready message", "job ready", "whatsapp", "email customer"],
      },
      {
        question: "Where do I edit default job steps?",
        answer:
          "Go to Admin > Jobs to manage the default job checklist and ready-message template that new jobs inherit.",
        keywords: ["job defaults", "checklist", "admin jobs", "ready template"],
      },
    ],
  },
  calendar: {
    area: "calendar",
    title: "Calendar",
    summary: "Schedule and review work in a date-based view linked back to jobs.",
    quickPrompts: [
      "How do I link calendar events to jobs?",
      "How do I find a scheduled job?",
    ],
    entries: [
      {
        question: "How do I link calendar events to jobs?",
        answer:
          "Use Calendar to work with scheduled job items, then jump back into the linked operational record when you need to update production details.",
        keywords: ["calendar", "event", "link job", "schedule"],
      },
      {
        question: "How do I find a scheduled job?",
        answer:
          "Select the event in Calendar and use the linked job navigation to open the related record in Jobs.",
        keywords: ["scheduled job", "calendar job", "open job"],
      },
    ],
  },
  marketing: {
    area: "marketing",
    title: "Marketing",
    summary: "Build campaigns, choose audiences, and manage customer outreach tools.",
    quickPrompts: [
      "How do I send a campaign?",
      "Where do I connect Mailchimp?",
      "How do I choose recipients?",
    ],
    entries: [
      {
        question: "How do I send a campaign?",
        answer:
          "Use Marketing to build your campaign, pick the audience, review the message, and then trigger the send action from there.",
        keywords: ["campaign", "send campaign", "marketing"],
      },
      {
        question: "Where do I connect Mailchimp?",
        answer:
          "Open Admin > Integrations. Mailchimp credentials are stored there alongside your other connected apps.",
        keywords: ["mailchimp", "integrations", "connected apps"],
      },
      {
        question: "How do I choose recipients?",
        answer:
          "In Marketing, use the audience controls to target all customers, filtered groups, or a custom list of selected recipients.",
        keywords: ["recipients", "audience", "segment", "customers"],
      },
    ],
  },
  stock: {
    area: "stock",
    title: "Stock",
    summary: "Monitor stock levels and manage day-to-day inventory information.",
    quickPrompts: [
      "How do I manage stock?",
      "Where do I edit catalog pricing?",
    ],
    entries: [
      {
        question: "How do I manage stock?",
        answer:
          "Use Stock for everyday inventory management. That is where you work with stock records and operational stock updates.",
        keywords: ["stock", "inventory", "manage stock"],
      },
      {
        question: "Where do I edit catalog pricing?",
        answer:
          "Use Admin for catalog setup and pricing such as frames, mats, glazing, printing materials, and backer boards.",
        keywords: ["catalog", "pricing", "frames", "mats", "glazing", "backers"],
      },
    ],
  },
  admin: {
    area: "admin",
    title: "Admin",
    summary: "Control centre for company settings, catalog setup, integrations, billing visibility, and future user/help management.",
    quickPrompts: [
      "Where are connected apps?",
      "How do I manage billing?",
      "Where will user management live?",
    ],
    entries: [
      {
        question: "Where are connected apps?",
        answer:
          "Go to Admin > Integrations. WhatsApp, Mailchimp, Outlook credentials, and billing overview are managed there.",
        keywords: ["connected apps", "integrations", "mailchimp", "outlook", "twilio", "whatsapp"],
      },
      {
        question: "How do I manage billing?",
        answer:
          "Use the Billing page for plan and subscription management. Admin > Integrations also includes the billing overview and Stripe portal access.",
        keywords: ["billing", "subscription", "stripe", "billing overview"],
      },
      {
        question: "Where will user management live?",
        answer:
          "User management is planned for Admin as its own section so team members, roles, and access controls can be managed from one place.",
        keywords: ["users", "roles", "team", "admin users"],
      },
    ],
  },
  billing: {
    area: "billing",
    title: "Billing",
    summary: "Subscription plans, access status, Founder availability, and Stripe management.",
    quickPrompts: [
      "How do I upgrade my plan?",
      "How do I manage Stripe subscription?",
    ],
    entries: [
      {
        question: "How do I upgrade my plan?",
        answer:
          "Open the Billing page to review available plans and start checkout for the subscription or Founder option that fits your account.",
        keywords: ["upgrade", "plan", "billing", "subscription"],
      },
      {
        question: "How do I manage Stripe subscription?",
        answer:
          "Use the billing management controls to open the Stripe customer portal when your account is eligible for portal access.",
        keywords: ["stripe", "portal", "manage subscription", "billing"],
      },
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
    ],
    entries: [
      {
        question: "Where do I connect WhatsApp?",
        answer:
          "Open Admin > Integrations and enter your Twilio WhatsApp credentials in the Connected apps section.",
        keywords: ["whatsapp", "twilio", "integrations", "connected apps"],
      },
      {
        question: "Where do I connect Outlook?",
        answer:
          "Open Admin > Integrations and enter your Microsoft and Outlook details in the Connected apps section.",
        keywords: ["outlook", "microsoft", "email", "integrations"],
      },
      {
        question: "Where do I connect Mailchimp?",
        answer:
          "Open Admin > Integrations and add your Mailchimp API key and server value in the Connected apps section.",
        keywords: ["mailchimp", "email marketing", "integrations"],
      },
    ],
  },
};

export function getHelpSection(area: string): HelpSection {
  const key = (area in helpSections ? area : "dashboard") as HelpArea;
  return helpSections[key];
}

export function findBestHelpReply(question: string, area: string): string {
  const normalizedQuestion = question.toLowerCase();
  const current = getHelpSection(area);
  const sections = [current, ...Object.values(helpSections).filter((section) => section.area !== current.area)];

  let bestAnswer = "";
  let bestScore = -1;

  for (const section of sections) {
    for (const entry of section.entries) {
      let score = 0;

      if (normalizedQuestion.includes(entry.question.toLowerCase())) {
        score += 5;
      }

      for (const keyword of entry.keywords) {
        if (normalizedQuestion.includes(keyword.toLowerCase())) {
          score += 2;
        }
      }

      if (section.area === current.area) {
        score += 1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestAnswer = entry.answer;
      }
    }
  }

  if (bestScore > 0) {
    return bestAnswer;
  }

  return `I do not have a precise answer for that yet, but I can help with ${current.title.toLowerCase()} topics such as ${current.quickPrompts
    .slice(0, 2)
    .join(" and ")}.`;
}