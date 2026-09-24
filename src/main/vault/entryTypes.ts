// Sekure entry types: a semantic layer on top of plain KDBX entries.
//
// Shared between main and renderer at runtime, so no imports.
//
// On disk an entry of a type is an ordinary KeePass entry:
//   - its values are string fields with human-readable names (`Passport number`, `IBAN`),
//     so every KeePass app shows and edits them as custom fields;
//   - secret fields are protected (main enforces this from the registry);
//   - the type is recorded in the entry's CustomData as `sekure.type = passport@1`,
//     which KeePass 2 / KeePassXC keep but do not show.
// If the marker goes missing, `detectType` recognises the entry from its field names.

export type FieldKind =
  | 'text'
  | 'secret'
  | 'multiline'
  | 'date'
  | 'country'
  | 'iban'
  | 'bic'
  | 'cardNumber'
  | 'expiry'
  | 'select'

/** The KeePass standard fields a type may reuse, so other apps' shortcuts still work. */
export type StandardTypeField = 'UserName' | 'Password' | 'URL'

export interface TypeField {
  /** The KDBX field name. For `standard` fields this is the standard name. */
  key: string
  label: string
  kind: FieldKind
  /** Stored as a protected value. Main enforces this whatever the renderer sends. */
  protected?: boolean
  required?: boolean
  options?: string[]
  standard?: StandardTypeField
  placeholder?: string
  /** Ids of `ID_FORMATS` this field accepts: recognised values get a hint in the form. */
  formats?: string[]
}

export type EntryTypeGroup =
  'login' | 'identity' | 'government' | 'finance' | 'health' | 'travel' | 'home' | 'tech' | 'other'

export interface EntryType {
  id: string
  /** Bumped when the field layout changes incompatibly; written into the marker. */
  version: number
  label: string
  group: EntryTypeGroup
  /** KeePass standard icon, so other apps show something sensible. */
  kdbxIcon: number
  fields: TypeField[]
  /** Field names whose presence identifies the type when the marker is missing. */
  signature: string[]
  /** Non-protected field keys joined into the list subtitle. */
  subtitle: string[]
  /** How subtitle parts combine: a separator, or `first` for the first non-empty one. */
  subtitleJoin?: string
  /** Field keys joined into a suggested title, after the type label. */
  titleHint?: string[]
  /** A date field shown as an expiry badge. */
  expiryField?: string
  /** One line for the new-entry wizard: what this type is for. */
  description: string
  /** Extra search words (synonyms, local names) for “Add …” suggestions and search. */
  keywords?: string[]
}

export const TYPE_MARKER_KEY = 'sekure.type'
export const LOGIN_TYPE = 'login'
/** The Person type: other entries link to Person entries. */
export const PERSON_TYPE = 'personalDetails'
/** Entry CustomData key holding the uuids of linked Person entries, comma-separated. */
export const PEOPLE_KEY = 'sekure.people'
/** At most this many people per entry. */
export const MAX_PEOPLE = 50

type FieldOptions = Partial<Omit<TypeField, 'key' | 'kind'>>

const field = (key: string, kind: FieldKind = 'text', opts: FieldOptions = {}): TypeField => ({
  key,
  label: key,
  kind,
  ...opts
})

const userName = (label = 'Username'): TypeField => ({
  key: 'UserName',
  label,
  kind: 'text',
  standard: 'UserName'
})

const password = (label = 'Password'): TypeField => ({
  key: 'Password',
  label,
  kind: 'secret',
  standard: 'Password',
  protected: true
})

const url = (label = 'Website'): TypeField => ({
  key: 'URL',
  label,
  kind: 'text',
  standard: 'URL',
  placeholder: 'https://'
})

/** Login, password and website of a provider's online portal. */
const portal = (): TypeField[] => [
  userName('Online login'),
  password('Online password'),
  url('Online access')
]

const names: TypeField[] = [
  { key: 'Given names', label: 'Given names', kind: 'text', required: true },
  { key: 'Surname', label: 'Surname', kind: 'text', required: true }
]

const person = {
  subtitle: ['Given names', 'Surname'],
  subtitleJoin: ' ',
  titleHint: ['Given names', 'Surname']
}

export const ENTRY_TYPES: EntryType[] = [
  {
    id: LOGIN_TYPE,
    version: 1,
    label: 'Login',
    description: 'A website or app account: username, password and address.',
    group: 'login',
    kdbxIcon: 0,
    fields: [userName(), password(), url()],
    signature: [],
    subtitle: ['UserName', 'URL'],
    subtitleJoin: 'first',
    keywords: ['website', 'account', 'password', 'passwort', 'sign in', 'anmeldung', 'zugang']
  },

  // ------------------------------------------------------------- identity
  {
    id: 'passport',
    version: 1,
    label: 'Passport',
    description: 'Passport number, nationality and validity, with an expiry reminder.',
    group: 'identity',
    kdbxIcon: 9,
    fields: [
      ...names,
      { key: 'Passport number', label: 'Passport number', kind: 'text', required: true },
      { key: 'Nationality', label: 'Nationality', kind: 'country' },
      { key: 'Date of birth', label: 'Date of birth', kind: 'date' },
      { key: 'Place of birth', label: 'Place of birth', kind: 'text' },
      { key: 'Sex', label: 'Sex', kind: 'select', options: ['F', 'M', 'X'] },
      { key: 'Issuing country', label: 'Issuing country', kind: 'country' },
      { key: 'Issuing authority', label: 'Issuing authority', kind: 'text' },
      { key: 'Date of issue', label: 'Date of issue', kind: 'date' },
      { key: 'Date of expiry', label: 'Date of expiry', kind: 'date' }
    ],
    signature: ['Passport number'],
    ...person,
    expiryField: 'Date of expiry',
    keywords: ['reisepass', 'pass', 'passeport', 'pasaporte', 'passaporto', 'travel document']
  },
  {
    id: 'idCard',
    version: 1,
    label: 'ID card',
    description: 'National ID card: number, address and validity.',
    group: 'identity',
    kdbxIcon: 9,
    fields: [
      ...names,
      { key: 'ID number', label: 'ID number', kind: 'text', required: true },
      { key: 'Nationality', label: 'Nationality', kind: 'country' },
      { key: 'Date of birth', label: 'Date of birth', kind: 'date' },
      { key: 'Address', label: 'Address', kind: 'multiline' },
      { key: 'Issuing authority', label: 'Issuing authority', kind: 'text' },
      { key: 'Date of issue', label: 'Date of issue', kind: 'date' },
      { key: 'Date of expiry', label: 'Date of expiry', kind: 'date' }
    ],
    signature: ['ID number'],
    ...person,
    expiryField: 'Date of expiry',
    keywords: [
      'personalausweis',
      'ausweis',
      'identity card',
      'national id',
      "carte d'identité",
      'dni',
      "carta d'identità",
      'identiteitskaart'
    ]
  },
  {
    id: 'driversLicense',
    version: 1,
    label: "Driver's license",
    description: 'License number, classes and expiry.',
    group: 'identity',
    kdbxIcon: 9,
    fields: [
      ...names,
      { key: 'License number', label: 'License number', kind: 'text', required: true },
      { key: 'License classes', label: 'Classes', kind: 'text', placeholder: 'B, BE' },
      { key: 'Date of birth', label: 'Date of birth', kind: 'date' },
      { key: 'Issuing country', label: 'Issuing country', kind: 'country' },
      { key: 'Issuing authority', label: 'Issuing authority', kind: 'text' },
      { key: 'Date of issue', label: 'Date of issue', kind: 'date' },
      { key: 'Date of expiry', label: 'Date of expiry', kind: 'date' }
    ],
    signature: ['License number'],
    ...person,
    expiryField: 'Date of expiry',
    keywords: ['führerschein', 'driving licence', 'permis de conduire', 'rijbewijs', 'patente']
  },
  {
    id: 'residencePermit',
    version: 1,
    label: 'Residence permit',
    description: 'Residence or work permit, with its type and expiry.',
    group: 'identity',
    kdbxIcon: 9,
    fields: [
      ...names,
      field('Permit number', 'text', { required: true }),
      field('Permit type', 'text', { placeholder: 'Permanent, work, EU Blue Card…' }),
      field('Nationality', 'country'),
      field('Date of birth', 'date'),
      field('Issuing country', 'country'),
      field('Issuing authority'),
      field('Date of issue', 'date'),
      field('Date of expiry', 'date')
    ],
    signature: ['Permit number'],
    ...person,
    expiryField: 'Date of expiry',
    keywords: [
      'aufenthaltstitel',
      'aufenthaltserlaubnis',
      'niederlassungserlaubnis',
      'green card',
      'work permit',
      'arbeitserlaubnis',
      'titre de séjour',
      'blue card'
    ]
  },
  {
    id: 'birthCertificate',
    version: 1,
    label: 'Birth certificate',
    description: 'Certificate number, place and registry office.',
    group: 'identity',
    kdbxIcon: 9,
    fields: [
      ...names,
      field('Certificate number', 'text', { required: true }),
      field('Date of birth', 'date'),
      field('Place of birth'),
      field('Issuing country', 'country'),
      field('Registry office'),
      field('Date of issue', 'date')
    ],
    signature: ['Certificate number'],
    ...person,
    keywords: ['geburtsurkunde', 'acte de naissance', 'standesamt', 'birth record']
  },
  {
    id: 'personalDetails',
    version: 1,
    label: 'Person',
    description: 'Someone whose documents you keep: name, birthday, contact, address.',
    group: 'identity',
    kdbxIcon: 9,
    fields: [
      ...names,
      field('Phone'),
      field('Email'),
      field('Date of birth', 'date'),
      field('Nationality', 'country'),
      field('Address', 'multiline'),
      field('Company'),
      field('Job title')
    ],
    // `Phone` first: the identity card shows the first signature field under the name.
    signature: ['Phone', 'Given names', 'Surname'],
    ...person,
    keywords: [
      'person',
      'people',
      'family',
      'familie',
      'partner',
      'kid',
      'kind',
      'contact',
      'address',
      'adresse',
      'anschrift',
      'profile',
      'persönliche daten',
      'me'
    ]
  },

  // ----------------------------------------------------------- government
  {
    id: 'taxId',
    version: 1,
    label: 'Tax ID',
    description: 'A personal or business tax number (Steuer-ID, EIN, NIF, …).',
    group: 'government',
    kdbxIcon: 67,
    fields: [
      field('Tax ID number', 'text', {
        required: true,
        formats: [
          'de-steuer-id',
          'us-ein',
          'us-itin',
          'it-codice-fiscale',
          'es-nif',
          'uk-utr',
          'fr-spi'
        ]
      }),
      field('Country', 'country'),
      field('ID kind', 'select', {
        options: ['Personal', 'Business', 'EIN', 'ITIN', 'Tax number', 'Other']
      }),
      field('Name'),
      field('Tax office')
    ],
    signature: ['Tax ID number'],
    subtitle: ['Country', 'ID kind'],
    titleHint: ['Name'],
    keywords: [
      'tax',
      'steuer',
      'steuer-id',
      'steuernummer',
      'steueridentifikationsnummer',
      'identifikationsnummer',
      'finanzamt',
      'tin',
      'ein',
      'itin',
      'nif',
      'utr',
      'codice fiscale',
      'numéro fiscal',
      'fiscal'
    ]
  },
  {
    id: 'socialSecurity',
    version: 1,
    label: 'Social security number',
    description: 'Social security or national insurance number, kept protected.',
    group: 'government',
    kdbxIcon: 9,
    fields: [
      field('Social security number', 'secret', {
        protected: true,
        required: true,
        label: 'Number',
        formats: ['us-ssn', 'de-sv-nummer', 'uk-nino', 'fr-nir', 'nl-bsn', 'ch-ahv']
      }),
      field('Country', 'country'),
      field('Name'),
      field('Issuing authority'),
      field('Date of issue', 'date')
    ],
    signature: ['Social security number'],
    subtitle: ['Country', 'Name'],
    titleHint: ['Name'],
    keywords: [
      'ssn',
      'social security',
      'sozialversicherung',
      'sozialversicherungsnummer',
      'rentenversicherung',
      'rentenversicherungsnummer',
      'national insurance',
      'nino',
      'national number',
      'bsn',
      'burgerservicenummer',
      'ahv',
      'avs',
      'nir',
      'sécurité sociale',
      'sin'
    ]
  },
  {
    id: 'vatId',
    version: 1,
    label: 'VAT / company ID',
    description: 'A company’s VAT number and registration details.',
    group: 'government',
    kdbxIcon: 67,
    fields: [
      field('Company', 'text', { required: true }),
      field('VAT number', 'text', { formats: ['eu-vat'] }),
      field('Registration number', 'text', { placeholder: 'HRB 12345' }),
      field('Registry court'),
      field('Country', 'country'),
      field('EORI number')
    ],
    signature: ['VAT number'],
    subtitle: ['VAT number', 'Registration number'],
    subtitleJoin: 'first',
    titleHint: ['Company'],
    keywords: [
      'vat',
      'ust-id',
      'ust-idnr',
      'umsatzsteuer',
      'mwst',
      'tva',
      'iva',
      'btw',
      'company',
      'firma',
      'business',
      'handelsregister',
      'eori'
    ]
  },

  // -------------------------------------------------------------- finance
  {
    id: 'bankAccount',
    version: 1,
    label: 'Bank account',
    description: 'IBAN and BIC, plus online-banking login.',
    group: 'finance',
    kdbxIcon: 37,
    fields: [
      { key: 'Account holder', label: 'Account holder', kind: 'text' },
      { key: 'Bank name', label: 'Bank', kind: 'text' },
      { key: 'IBAN', label: 'IBAN', kind: 'iban', required: true },
      { key: 'BIC', label: 'BIC / SWIFT', kind: 'bic' },
      userName('Online banking login'),
      password('Online banking password'),
      url('Online banking')
    ],
    signature: ['IBAN'],
    subtitle: ['Bank name', 'IBAN'],
    titleHint: ['Bank name'],
    keywords: ['bank', 'konto', 'girokonto', 'sparkonto', 'checking', 'savings', 'account']
  },
  {
    id: 'creditCard',
    version: 1,
    label: 'Payment card',
    description: 'Credit or debit card: number, expiry, security code and PIN.',
    group: 'finance',
    kdbxIcon: 66,
    fields: [
      { key: 'Cardholder', label: 'Cardholder', kind: 'text' },
      {
        key: 'Card number',
        label: 'Card number',
        kind: 'cardNumber',
        protected: true,
        required: true
      },
      { key: 'Expiry', label: 'Expiry', kind: 'expiry', placeholder: 'MM/YY' },
      { key: 'CVV', label: 'Security code', kind: 'secret', protected: true },
      { key: 'PIN', label: 'PIN', kind: 'secret', protected: true },
      { key: 'Card issuer', label: 'Issuer', kind: 'text' }
    ],
    signature: ['Card number'],
    subtitle: ['Card issuer', 'Expiry'],
    titleHint: ['Card issuer'],
    keywords: [
      'credit card',
      'debit card',
      'kreditkarte',
      'ec-karte',
      'girocard',
      'bankkarte',
      'visa',
      'mastercard',
      'amex'
    ]
  },
  {
    id: 'investmentAccount',
    version: 1,
    label: 'Investment account',
    description: 'Broker, depot and clearing account, with the portal login.',
    group: 'finance',
    kdbxIcon: 37,
    fields: [
      field('Broker', 'text', { required: true }),
      field('Brokerage account', 'text', { label: 'Account number' }),
      field('Clearing account', 'iban', { label: 'Clearing account (IBAN)' }),
      field('Account holder'),
      ...portal()
    ],
    signature: ['Brokerage account'],
    subtitle: ['Broker', 'Brokerage account'],
    titleHint: ['Broker'],
    keywords: [
      'depot',
      'broker',
      'brokerage',
      'stocks',
      'aktien',
      'etf',
      'portfolio',
      'trading',
      'wertpapier'
    ]
  },
  {
    id: 'cryptoWallet',
    version: 1,
    label: 'Crypto wallet',
    description: 'Wallet address and the seed phrase, kept protected.',
    group: 'finance',
    kdbxIcon: 66,
    fields: [
      field('Wallet', 'text', { placeholder: 'Ledger, MetaMask…' }),
      field('Network', 'text', { placeholder: 'Bitcoin, Ethereum…' }),
      field('Wallet address'),
      field('Seed phrase', 'multiline', { protected: true, required: true }),
      password('Wallet password'),
      field('Wallet PIN', 'secret', { protected: true, label: 'PIN' })
    ],
    signature: ['Seed phrase'],
    subtitle: ['Wallet', 'Network'],
    titleHint: ['Wallet'],
    keywords: [
      'crypto',
      'bitcoin',
      'ethereum',
      'wallet',
      'seed',
      'mnemonic',
      'recovery phrase',
      'ledger',
      'metamask',
      'krypto'
    ]
  },
  {
    id: 'loan',
    version: 1,
    label: 'Loan / mortgage',
    description: 'Loan or mortgage contract, amount, rate and end date.',
    group: 'finance',
    kdbxIcon: 37,
    fields: [
      field('Lender', 'text', { required: true }),
      field('Loan contract number', 'text', { label: 'Contract number' }),
      field('Loan amount', 'text', { label: 'Amount' }),
      field('Interest rate'),
      field('Monthly payment'),
      field('Loan end', 'date', { label: 'Ends' }),
      ...portal()
    ],
    signature: ['Loan contract number'],
    subtitle: ['Lender', 'Loan amount'],
    titleHint: ['Lender'],
    expiryField: 'Loan end',
    keywords: [
      'kredit',
      'darlehen',
      'mortgage',
      'hypothek',
      'baufinanzierung',
      'finanzierung',
      'leasing',
      'student loan'
    ]
  },
  {
    id: 'giftCard',
    version: 1,
    label: 'Gift card',
    description: 'Gift card or voucher number, PIN and balance.',
    group: 'finance',
    kdbxIcon: 66,
    fields: [
      field('Store', 'text', { required: true }),
      field('Gift card number', 'text', { label: 'Card number' }),
      field('Gift card PIN', 'secret', { protected: true, label: 'PIN' }),
      field('Balance'),
      field('Valid until', 'date'),
      url('Balance check')
    ],
    signature: ['Gift card number'],
    subtitle: ['Store', 'Balance'],
    titleHint: ['Store'],
    expiryField: 'Valid until',
    keywords: ['gutschein', 'voucher', 'geschenkkarte', 'prepaid', 'guthaben', 'coupon']
  },

  // --------------------------------------------------------------- health
  {
    id: 'healthInsurance',
    version: 1,
    label: 'Health insurance',
    description: 'Health insurer, member and card number.',
    group: 'health',
    kdbxIcon: 9,
    fields: [
      field('Insurer', 'text', { required: true }),
      field('Health insurance number', 'text', { label: 'Member number' }),
      field('Insured person'),
      field('Insurance card number', 'text', { label: 'Card number' }),
      field('Plan'),
      field('Valid until', 'date'),
      field('Insurer phone', 'text', { label: 'Phone' }),
      ...portal()
    ],
    signature: ['Health insurance number'],
    subtitle: ['Insurer', 'Plan'],
    titleHint: ['Insurer'],
    expiryField: 'Valid until',
    keywords: [
      'krankenkasse',
      'krankenversicherung',
      'aok',
      'barmer',
      'dak',
      'versichertennummer',
      'gesundheitskarte',
      'egk',
      'health card',
      'medical insurance',
      'ehic',
      'carte vitale',
      'mutuelle',
      'zorgverzekering'
    ]
  },
  {
    id: 'insurancePolicy',
    version: 1,
    label: 'Insurance policy',
    description: 'Any policy: home, car, liability, life, travel.',
    group: 'health',
    kdbxIcon: 67,
    fields: [
      field('Insurer', 'text', { required: true }),
      field('Policy number', 'text', { required: true }),
      field('Insurance kind', 'select', {
        label: 'Kind',
        options: ['Home', 'Car', 'Liability', 'Life', 'Travel', 'Legal', 'Disability', 'Other']
      }),
      field('Insured'),
      field('Premium'),
      field('Renewal date', 'date'),
      field('Claims phone'),
      ...portal()
    ],
    signature: ['Policy number'],
    subtitle: ['Insurer', 'Insurance kind'],
    titleHint: ['Insurance kind', 'Insurer'],
    expiryField: 'Renewal date',
    keywords: [
      'versicherung',
      'police',
      'versicherungsschein',
      'haftpflicht',
      'hausrat',
      'kfz-versicherung',
      'car insurance',
      'home insurance',
      'life insurance',
      'lebensversicherung',
      'rechtsschutz',
      'liability',
      'travel insurance',
      'assurance'
    ]
  },
  {
    id: 'medicalInfo',
    version: 1,
    label: 'Medical info',
    description: 'Blood type, allergies, medication and your doctor.',
    group: 'health',
    kdbxIcon: 46,
    fields: [
      field('Blood type', 'select', {
        options: ['0+', '0−', 'A+', 'A−', 'B+', 'B−', 'AB+', 'AB−']
      }),
      field('Allergies', 'multiline'),
      field('Medication', 'multiline'),
      field('Conditions', 'multiline'),
      field('Doctor'),
      field('Doctor phone'),
      field('Emergency contact')
    ],
    signature: ['Blood type'],
    subtitle: ['Doctor'],
    keywords: [
      'medical',
      'allergies',
      'allergie',
      'blood',
      'blutgruppe',
      'medication',
      'medikamente',
      'doctor',
      'arzt',
      'hausarzt',
      'notfall',
      'emergency',
      'vaccination',
      'impfung'
    ]
  },

  // --------------------------------------------------------------- travel
  {
    id: 'visa',
    version: 1,
    label: 'Visa',
    description: 'Visa for a country, its type, entries and validity.',
    group: 'travel',
    kdbxIcon: 9,
    fields: [
      ...names,
      field('Visa number', 'text', { required: true }),
      field('Visa country', 'country', { label: 'Country' }),
      field('Visa type', 'text', { label: 'Type', placeholder: 'Tourist, work, ESTA…' }),
      field('Entries', 'select', { options: ['Single', 'Double', 'Multiple'] }),
      field('Visa passport number', 'text', { label: 'Passport number' }),
      field('Valid from', 'date'),
      field('Valid until', 'date')
    ],
    signature: ['Visa number'],
    subtitle: ['Visa country', 'Visa type'],
    titleHint: ['Visa country'],
    expiryField: 'Valid until',
    keywords: ['visum', 'entry permit', 'esta', 'eta', 'evisa', 'travel authorization']
  },
  {
    id: 'loyaltyProgram',
    version: 1,
    label: 'Loyalty program',
    description: 'Miles, points or rewards membership with its login.',
    group: 'travel',
    kdbxIcon: 61,
    fields: [
      field('Program', 'text', { required: true }),
      field('Loyalty number', 'text', { label: 'Member number' }),
      field('Tier'),
      field('Member name'),
      ...portal()
    ],
    signature: ['Loyalty number'],
    subtitle: ['Program', 'Tier'],
    titleHint: ['Program'],
    keywords: [
      'miles',
      'meilen',
      'frequent flyer',
      'vielflieger',
      'miles & more',
      'payback',
      'bahncard',
      'bonus',
      'rewards',
      'points',
      'hotel'
    ]
  },
  {
    id: 'membership',
    version: 1,
    label: 'Membership',
    description: 'Club, gym, library or student card.',
    group: 'travel',
    kdbxIcon: 61,
    fields: [
      field('Organization', 'text', { required: true }),
      field('Membership number', 'text', { label: 'Member number' }),
      field('Member name'),
      field('Member since', 'date'),
      field('Valid until', 'date'),
      field('Membership PIN', 'secret', { protected: true, label: 'PIN' }),
      url()
    ],
    signature: ['Membership number'],
    subtitle: ['Organization', 'Membership number'],
    titleHint: ['Organization'],
    expiryField: 'Valid until',
    keywords: [
      'mitglied',
      'mitgliedschaft',
      'mitgliedsausweis',
      'club',
      'verein',
      'gym',
      'fitness',
      'library',
      'bibliothek',
      'student id',
      'studentenausweis',
      'automobile club',
      'adac'
    ]
  },

  // ------------------------------------------------------ home & vehicles
  {
    id: 'vehicle',
    version: 1,
    label: 'Vehicle',
    description: 'Car or motorbike: plate, VIN and registration.',
    group: 'home',
    kdbxIcon: 6,
    fields: [
      field('Make and model', 'text', { required: true }),
      field('License plate'),
      field('VIN', 'text', { formats: ['vin'] }),
      field('Registration document', 'text', { label: 'Registration doc number' }),
      field('First registration', 'date'),
      field('Inspection due', 'date'),
      field('Vehicle insurance', 'text', { label: 'Insurance' })
    ],
    signature: ['VIN'],
    subtitle: ['Make and model', 'License plate'],
    titleHint: ['Make and model'],
    expiryField: 'Inspection due',
    keywords: [
      'car',
      'auto',
      'fahrzeug',
      'kfz',
      'kennzeichen',
      'license plate',
      'fahrzeugschein',
      'zulassung',
      'tüv',
      'motorcycle',
      'motorrad'
    ]
  },
  {
    id: 'phone',
    version: 1,
    label: 'Phone / SIM',
    description: 'Phone number, SIM PIN, PUK and IMEI.',
    group: 'home',
    kdbxIcon: 68,
    fields: [
      field('Phone number', 'text', { required: true }),
      field('Carrier'),
      field('SIM PIN', 'secret', { protected: true }),
      field('PUK', 'secret', { protected: true }),
      field('IMEI', 'text', { formats: ['imei'] }),
      field('SIM number'),
      ...portal()
    ],
    signature: ['PUK'],
    subtitle: ['Phone number', 'Carrier'],
    titleHint: ['Carrier'],
    keywords: [
      'sim',
      'mobile',
      'handy',
      'mobilfunk',
      'smartphone',
      'puk',
      'imei',
      'carrier',
      'cell phone'
    ]
  },
  {
    id: 'alarmCode',
    version: 1,
    label: 'Alarm / door code',
    description: 'Alarm, door, gate or safe codes for a place.',
    group: 'home',
    kdbxIcon: 60,
    fields: [
      field('Location', 'text', { required: true }),
      field('Alarm code', 'secret', { protected: true, label: 'Code' }),
      field('Master code', 'secret', { protected: true }),
      field('Duress code', 'secret', { protected: true }),
      field('Alarm company', 'text', { label: 'Company' }),
      field('Company phone')
    ],
    signature: ['Alarm code'],
    subtitle: ['Location'],
    titleHint: ['Location'],
    keywords: [
      'alarm',
      'door code',
      'türcode',
      'safe',
      'tresor',
      'combination',
      'garage',
      'gate',
      'zahlenschloss',
      'keypad'
    ]
  },
  {
    id: 'utilityAccount',
    version: 1,
    label: 'Utility account',
    description: 'Electricity, gas, water or internet contract and meter.',
    group: 'home',
    kdbxIcon: 14,
    fields: [
      field('Provider', 'text', { required: true }),
      field('Utility kind', 'select', {
        label: 'Kind',
        options: ['Electricity', 'Gas', 'Water', 'Internet', 'TV', 'Heating', 'Waste', 'Other']
      }),
      field('Customer number'),
      field('Contract number'),
      field('Meter number'),
      ...portal()
    ],
    signature: ['Meter number'],
    subtitle: ['Provider', 'Utility kind'],
    titleHint: ['Provider'],
    keywords: [
      'strom',
      'gas',
      'wasser',
      'electricity',
      'water',
      'internet',
      'dsl',
      'stadtwerke',
      'meter',
      'zähler',
      'kundennummer',
      'energy',
      'rundfunkbeitrag'
    ]
  },
  {
    id: 'device',
    version: 1,
    label: 'Device',
    description: 'A device’s serial number, purchase and warranty.',
    group: 'home',
    kdbxIcon: 23,
    fields: [
      field('Device name', 'text', { label: 'Device', required: true }),
      field('Serial number'),
      field('Model number'),
      field('Purchase date', 'date'),
      field('Store'),
      field('Warranty until', 'date'),
      field('Device PIN', 'secret', { protected: true, label: 'Unlock PIN' })
    ],
    signature: ['Serial number'],
    subtitle: ['Device name', 'Serial number'],
    titleHint: ['Device name'],
    expiryField: 'Warranty until',
    keywords: [
      'serial',
      'seriennummer',
      'warranty',
      'garantie',
      'laptop',
      'hardware',
      'receipt',
      'kaufbeleg',
      'appliance'
    ]
  },

  // ----------------------------------------------------------------- tech
  {
    id: 'emailAccount',
    version: 1,
    label: 'Email account',
    description: 'Email address with IMAP/SMTP server settings.',
    group: 'tech',
    kdbxIcon: 19,
    fields: [
      userName('Email address'),
      password(),
      url('Webmail'),
      field('IMAP server'),
      field('IMAP port'),
      field('SMTP server'),
      field('SMTP port')
    ],
    signature: ['IMAP server'],
    subtitle: ['UserName'],
    keywords: ['email', 'e-mail', 'mail', 'imap', 'smtp', 'mailbox', 'postfach', 'webmail']
  },
  {
    id: 'server',
    version: 1,
    label: 'Server',
    description: 'Host, port and credentials for a server.',
    group: 'tech',
    kdbxIcon: 3,
    fields: [
      field('Hostname', 'text', { required: true }),
      field('Port'),
      userName(),
      password(),
      field('Root password', 'secret', { protected: true }),
      field('Provider'),
      url('Control panel')
    ],
    signature: ['Hostname'],
    subtitle: ['Hostname'],
    titleHint: ['Hostname'],
    keywords: ['vps', 'host', 'hosting', 'ssh', 'root', 'machine', 'cloud', 'rechner']
  },
  {
    id: 'database',
    version: 1,
    label: 'Database',
    description: 'Database host, name, user and connection string.',
    group: 'tech',
    kdbxIcon: 42,
    fields: [
      field('Database kind', 'select', {
        label: 'Kind',
        options: [
          'PostgreSQL',
          'MySQL',
          'MariaDB',
          'SQL Server',
          'Oracle',
          'MongoDB',
          'Redis',
          'SQLite',
          'Other'
        ]
      }),
      field('Database host', 'text', { label: 'Host' }),
      field('Database port', 'text', { label: 'Port' }),
      field('Database name', 'text', { label: 'Database' }),
      userName(),
      password(),
      field('Connection string', 'secret', { protected: true })
    ],
    signature: ['Database host'],
    subtitle: ['Database kind', 'Database host'],
    titleHint: ['Database name'],
    keywords: ['db', 'postgres', 'mysql', 'mariadb', 'mongodb', 'sql', 'redis', 'datenbank']
  },
  {
    id: 'router',
    version: 1,
    label: 'Router',
    description: 'Router admin page and credentials.',
    group: 'tech',
    kdbxIcon: 12,
    fields: [
      field('Router model', 'text', { label: 'Model' }),
      url('Admin page'),
      userName('Admin user'),
      password('Admin password'),
      field('Router serial', 'text', { label: 'Serial number' }),
      field('Network name')
    ],
    signature: ['Router model'],
    subtitle: ['Router model'],
    titleHint: ['Router model'],
    keywords: ['fritzbox', 'modem', 'gateway', 'admin', 'access point', 'network']
  },
  {
    id: 'wifi',
    version: 1,
    label: 'Wi-Fi network',
    description: 'Network name and password, for sharing with guests.',
    group: 'tech',
    kdbxIcon: 12,
    fields: [
      { key: 'SSID', label: 'Network name', kind: 'text', required: true },
      password(),
      {
        key: 'Security',
        label: 'Security',
        kind: 'select',
        options: ['WPA3', 'WPA2', 'WPA', 'WEP', 'None']
      },
      { key: 'Hidden network', label: 'Hidden network', kind: 'select', options: ['No', 'Yes'] }
    ],
    signature: ['SSID'],
    subtitle: ['SSID'],
    titleHint: ['SSID'],
    keywords: ['wlan', 'wifi', 'wireless', 'hotspot', 'netzwerk']
  },
  {
    id: 'sshKey',
    version: 1,
    label: 'SSH key',
    description: 'Private and public key, passphrase and host.',
    group: 'tech',
    kdbxIcon: 29,
    fields: [
      {
        key: 'Private key',
        label: 'Private key',
        kind: 'multiline',
        protected: true,
        required: true
      },
      { key: 'Public key', label: 'Public key', kind: 'multiline' },
      password('Passphrase'),
      { key: 'Fingerprint', label: 'Fingerprint', kind: 'text' },
      userName('User'),
      { key: 'Host', label: 'Host', kind: 'text' }
    ],
    signature: ['Private key'],
    subtitle: ['Host'],
    titleHint: ['Host'],
    keywords: ['ssh', 'key pair', 'private key', 'ed25519', 'rsa', 'pgp', 'gpg']
  },
  {
    id: 'apiToken',
    version: 1,
    label: 'API token',
    description: 'An API key or token, its endpoint, scopes and expiry.',
    group: 'tech',
    kdbxIcon: 58,
    fields: [
      { key: 'API token', label: 'Token', kind: 'secret', protected: true, required: true },
      userName('Client / key ID'),
      url('Endpoint'),
      { key: 'Scopes', label: 'Scopes', kind: 'text' },
      { key: 'Token expiry', label: 'Expires', kind: 'date' }
    ],
    signature: ['API token'],
    subtitle: ['Scopes'],
    titleHint: [],
    expiryField: 'Token expiry',
    keywords: ['api', 'token', 'api key', 'secret', 'bearer', 'access token', 'personal access']
  },
  {
    id: 'recoveryCodes',
    version: 1,
    label: 'Recovery codes',
    description: 'Backup codes for two-factor sign-in.',
    group: 'tech',
    kdbxIcon: 13,
    fields: [
      field('Service', 'text', { required: true }),
      userName('Account'),
      field('Recovery codes', 'multiline', { protected: true, required: true, label: 'Codes' }),
      field('Generated on', 'date')
    ],
    signature: ['Recovery codes'],
    subtitle: ['Service'],
    titleHint: ['Service'],
    keywords: [
      'backup codes',
      '2fa',
      'two-factor',
      'mfa',
      'recovery',
      'wiederherstellung',
      'notfallcodes'
    ]
  },
  {
    id: 'softwareLicense',
    version: 1,
    label: 'Software license',
    description: 'License key, order number and download page.',
    group: 'tech',
    kdbxIcon: 67,
    fields: [
      { key: 'Product', label: 'Product', kind: 'text' },
      { key: 'Version', label: 'Version', kind: 'text' },
      {
        key: 'License key',
        label: 'License key',
        kind: 'multiline',
        protected: true,
        required: true
      },
      { key: 'Licensed to', label: 'Licensed to', kind: 'text' },
      userName('Registered email'),
      { key: 'Order number', label: 'Order number', kind: 'text' },
      { key: 'Purchase date', label: 'Purchase date', kind: 'date' },
      url('Download page')
    ],
    signature: ['License key'],
    subtitle: ['Product', 'Version'],
    titleHint: ['Product'],
    keywords: ['license key', 'lizenz', 'serial key', 'product key', 'activation', 'software']
  },

  // ---------------------------------------------------------------- other
  {
    id: 'secureNote',
    version: 1,
    label: 'Secure note',
    description: 'Free text, encrypted like everything else.',
    group: 'other',
    kdbxIcon: 44,
    fields: [],
    signature: [],
    subtitle: [],
    keywords: ['note', 'notiz', 'text', 'memo', 'document']
  }
]

export const ENTRY_TYPE_GROUPS: { id: EntryTypeGroup; label: string }[] = [
  { id: 'login', label: 'Logins' },
  { id: 'identity', label: 'Identity' },
  { id: 'government', label: 'Government & tax' },
  { id: 'finance', label: 'Finance' },
  { id: 'health', label: 'Health & insurance' },
  { id: 'travel', label: 'Travel & memberships' },
  { id: 'home', label: 'Home & vehicles' },
  { id: 'tech', label: 'Accounts & tech' },
  { id: 'other', label: 'Other' }
]

const BY_ID = new Map(ENTRY_TYPES.map((t) => [t.id, t]))

export const getType = (id: string | undefined): EntryType | undefined =>
  id === undefined ? undefined : BY_ID.get(id)

export const loginType = (): EntryType => BY_ID.get(LOGIN_TYPE)!

/** `passport@1` → `{ id: 'passport', version: 1 }`. Unknown or malformed → undefined. */
export function parseMarker(
  marker: string | undefined
): { id: string; version: number } | undefined {
  const m = marker?.match(/^([A-Za-z][\w-]*)@(\d+)$/)
  if (!m) return undefined
  return { id: m[1], version: Number(m[2]) }
}

export const formatMarker = (t: EntryType): string => `${t.id}@${t.version}`

/** Recognise a type from an entry's field names. The most specific signature wins. */
export function detectType(fieldKeys: Iterable<string>): EntryType | undefined {
  const keys = new Set(fieldKeys)
  let best: EntryType | undefined
  for (const t of ENTRY_TYPES) {
    if (!t.signature.length || !t.signature.every((k) => keys.has(k))) continue
    if (!best || t.signature.length > best.signature.length) best = t
  }
  return best
}

/** The list subtitle from an entry's (non-protected) values. */
export function subtitleFor(t: EntryType, value: (key: string) => string): string {
  const parts = t.subtitle.map(value).filter(Boolean)
  if (t.subtitleJoin === 'first') return parts[0] ?? ''
  return parts.join(t.subtitleJoin ?? ' · ')
}

/** Suggested title for an untitled entry, e.g. `Passport – Jane Doe`. */
export function suggestTitle(t: EntryType, value: (key: string) => string): string {
  const hint = (t.titleHint ?? []).map(value).filter(Boolean).join(' ')
  return hint ? `${t.label} – ${hint}` : t.label
}

/** Types whose subtitle is a person's name (Person, passport, ID card…): link suggestions compare it. */
export const namesPerson = (t: EntryType): boolean => t.subtitle.includes('Surname')

/** Field keys a type stores outside the standard KeePass fields. */
export const customKeys = (t: EntryType): string[] =>
  t.fields.filter((f) => !f.standard).map((f) => f.key)

// ---------------------------------------------------------------- values

const group4 = (s: string) => s.replace(/(.{4})(?=.)/g, '$1 ')

/** Canonical, human-readable text for a value, as stored in the KDBX field. */
export function normalizeValue(kind: FieldKind, raw: string): string {
  const v = raw.trim()
  if (!v) return ''
  switch (kind) {
    case 'iban':
      return group4(v.replace(/\s+/g, '').toUpperCase())
    case 'cardNumber':
      return group4(v.replace(/[\s-]+/g, ''))
    case 'bic':
    case 'country':
      return v.replace(/\s+/g, '').toUpperCase()
    case 'expiry': {
      const m = v.match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/)
      return m ? `${m[1].padStart(2, '0')}/${m[2].slice(-2)}` : v
    }
    case 'multiline':
    case 'secret':
      return raw
    default:
      return v
  }
}

function ibanValid(iban: string): boolean {
  const s = iban.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false
  const rearranged = s.slice(4) + s.slice(0, 4)
  let rem = 0
  for (const ch of rearranged) {
    const n = ch >= 'A' ? ch.charCodeAt(0) - 55 : Number(ch)
    rem = Number(`${rem}${n}`) % 97
  }
  return rem === 1
}

function luhnValid(number: string): boolean {
  const s = number.replace(/[\s-]+/g, '')
  if (!/^\d{12,19}$/.test(s)) return false
  let sum = 0
  for (let i = 0; i < s.length; i++) {
    let d = Number(s[s.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

/** A user-facing problem with a value, or undefined when it is fine (empty is fine). */
export function validateValue(kind: FieldKind, raw: string): string | undefined {
  const v = raw.trim()
  if (!v) return undefined
  switch (kind) {
    case 'iban':
      return ibanValid(v) ? undefined : 'Not a valid IBAN'
    case 'bic':
      return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v.replace(/\s+/g, '').toUpperCase())
        ? undefined
        : 'Not a valid BIC'
    case 'cardNumber':
      return luhnValid(v) ? undefined : 'Not a valid card number'
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'Use YYYY-MM-DD'
      const d = new Date(`${v}T00:00:00Z`)
      return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v
        ? 'Not a valid date'
        : undefined
    }
    case 'expiry':
      return /^(0[1-9]|1[0-2])\/\d{2}$/.test(normalizeValue('expiry', v)) ? undefined : 'Use MM/YY'
    case 'country':
      return /^[A-Za-z]{2,3}$/.test(v) ? undefined : 'Use a 2- or 3-letter country code'
    default:
      return undefined
  }
}

// ------------------------------------------------------------ id formats
//
// Well-known identifier formats, so a number typed into search can be offered as a
// new entry of the right type, and a typed field can say which format it recognised.
// Checksums are verified where the format has one.

export interface IdFormat {
  id: string
  label: string
  /** ISO country of the number; prefilled into the type's `Country` field. */
  country?: string
  typeId: string
  fieldKey: string
  /** Further values prefilled with a recognised number, e.g. `ID kind: EIN`. */
  extra?: Record<string, string>
  /**
   * 3: checksum verified, 2: distinctive pattern, 1: loose pattern,
   * 0: too ambiguous to suggest from search (field hints only).
   */
  strength: 0 | 1 | 2 | 3
  /** `compact` is upper-case with spaces, dots, dashes and slashes removed. */
  test: (compact: string, raw: string) => boolean
  /** Canonical text for the field; the trimmed input when absent. */
  format?: (compact: string, raw: string) => string
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const compactId = (raw: string) => raw.replace(/[\s.\-/]+/g, '').toUpperCase()

/** Remainder of a long decimal string modulo `m`, without BigInt. */
function mod(numeric: string, m: number): number {
  let rem = 0
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % m
  return rem
}

function steuerIdValid(s: string): boolean {
  if (!/^[1-9]\d{10}$/.test(s)) return false
  let product = 10
  for (const ch of s.slice(0, 10)) {
    const sum = (Number(ch) + product) % 10 || 10
    product = (sum * 2) % 11
  }
  return (11 - product) % 10 === Number(s[10])
}

function svNummerValid(s: string): boolean {
  const m = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})([A-Z])(\d{2})(\d)$/)
  if (!m) return false
  const day = Number(m[2]) % 50
  const month = Number(m[3])
  if (day < 1 || day > 31 || month < 1 || month > 12) return false
  const letter = String(m[5].charCodeAt(0) - 64).padStart(2, '0')
  const ds = [...`${m[1]}${m[2]}${m[3]}${m[4]}${letter}${m[6]}`].map(Number)
  const weights = [2, 1, 2, 5, 7, 1, 2, 1, 2, 1, 2, 1]
  const sum = ds.reduce((acc, d, i) => {
    const p = d * weights[i]
    return acc + Math.floor(p / 10) + (p % 10)
  }, 0)
  return sum % 10 === Number(m[7])
}

function nirValid(s: string): boolean {
  if (!/^[12]\d{4}(\d{2}|2A|2B)\d{8}$/.test(s)) return false
  const body = s.slice(0, 13).replace('2A', '19').replace('2B', '18')
  return 97 - mod(body, 97) === Number(s.slice(13))
}

const CF_ODD = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21]
const CF_ODD_LETTERS = [
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23
]

function codiceFiscaleValid(s: string): boolean {
  if (!/^[A-Z]{6}[0-9LMNP-V]{2}[A-EHLMPRST][0-9LMNP-V]{2}[A-Z][0-9LMNP-V]{3}[A-Z]$/.test(s))
    return false
  let sum = 0
  for (let i = 0; i < 15; i++) {
    const ch = s[i]
    const isDigit = ch >= '0' && ch <= '9'
    const v = isDigit ? Number(ch) : ch.charCodeAt(0) - 65
    // Positions are 1-based in the spec: odd positions use the odd table.
    sum += i % 2 === 0 ? (isDigit ? CF_ODD[v] : CF_ODD_LETTERS[v]) : v
  }
  return String.fromCharCode(65 + (sum % 26)) === s[15]
}

function nifValid(s: string): boolean {
  const m = s.match(/^([XYZ]\d{7}|\d{8})([A-Z])$/)
  if (!m) return false
  const n = m[1].replace(/^[XYZ]/, (c) => String('XYZ'.indexOf(c)))
  return 'TRWAGMYFPDXBNJZSQVHLCKE'[Number(n) % 23] === m[2]
}

function bsnValid(s: string): boolean {
  if (!/^\d{9}$/.test(s) || /^0+$/.test(s)) return false
  const ds = [...s].map(Number)
  const sum = ds.slice(0, 8).reduce((acc, d, i) => acc + d * (9 - i), 0) - ds[8]
  return sum % 11 === 0
}

function ean13Valid(s: string): boolean {
  if (!/^\d{13}$/.test(s)) return false
  const ds = [...s].map(Number)
  const sum = ds.slice(0, 12).reduce((acc, d, i) => acc + d * (i % 2 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === ds[12]
}

const EU_VAT =
  /^(ATU\d{8}|BE[01]\d{9}|BG\d{9,10}|CY\d{8}[A-Z]|CZ\d{8,10}|DE\d{9}|DK\d{8}|EE\d{9}|EL\d{9}|ES[A-Z0-9]\d{7}[A-Z0-9]|FI\d{8}|FR[A-HJ-NP-Z0-9]{2}\d{9}|HR\d{11}|HU\d{8}|IE\d{7}[A-W][A-I]?|IT\d{11}|LT(\d{9}|\d{12})|LU\d{8}|LV\d{11}|MT\d{8}|NL\d{9}B\d{2}|PL\d{10}|PT\d{9}|RO\d{2,10}|SE\d{12}|SI\d{8}|SK\d{10}|XI\d{9}|GB(\d{9}|\d{12})|CHE\d{9}(MWST|TVA|IVA)?)$/

const vatCountry = (s: string) => {
  const cc = s.slice(0, 2)
  return cc === 'EL' ? 'GR' : cc === 'XI' ? 'GB' : cc
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/
const WEB_ADDRESS = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i

export const ID_FORMATS: IdFormat[] = [
  {
    id: 'iban',
    label: 'IBAN',
    typeId: 'bankAccount',
    fieldKey: 'IBAN',
    strength: 3,
    test: (s) => ibanValid(s),
    format: (s) => group4(s)
  },
  {
    id: 'card',
    label: 'Card number',
    typeId: 'creditCard',
    fieldKey: 'Card number',
    strength: 3,
    test: (s) => /^[2-6]\d{12,18}$/.test(s) && luhnValid(s),
    format: (s) => group4(s)
  },
  {
    id: 'de-steuer-id',
    label: 'German tax ID',
    country: 'DE',
    typeId: 'taxId',
    fieldKey: 'Tax ID number',
    extra: { 'ID kind': 'Personal' },
    strength: 3,
    test: steuerIdValid,
    format: (s) => `${s.slice(0, 2)} ${s.slice(2, 5)} ${s.slice(5, 8)} ${s.slice(8)}`
  },
  {
    id: 'it-codice-fiscale',
    label: 'Italian codice fiscale',
    country: 'IT',
    typeId: 'taxId',
    fieldKey: 'Tax ID number',
    extra: { 'ID kind': 'Personal' },
    strength: 3,
    test: codiceFiscaleValid,
    format: (s) => s
  },
  {
    id: 'es-nif',
    label: 'Spanish NIF / NIE',
    country: 'ES',
    typeId: 'taxId',
    fieldKey: 'Tax ID number',
    extra: { 'ID kind': 'Personal' },
    strength: 3,
    test: nifValid,
    format: (s) => s
  },
  {
    id: 'us-ein',
    label: 'US EIN',
    country: 'US',
    typeId: 'taxId',
    fieldKey: 'Tax ID number',
    extra: { 'ID kind': 'EIN' },
    strength: 2,
    test: (_s, raw) => /^(?!00)\d{2}-\d{7}$/.test(raw.trim()),
    format: (s) => `${s.slice(0, 2)}-${s.slice(2)}`
  },
  {
    id: 'us-itin',
    label: 'US ITIN',
    country: 'US',
    typeId: 'taxId',
    fieldKey: 'Tax ID number',
    extra: { 'ID kind': 'ITIN' },
    strength: 2,
    test: (_s, raw) => /^9\d{2}[- ](5\d|6[0-5]|7\d|8[0-8]|9[0-24-9])[- ]\d{4}$/.test(raw.trim()),
    format: (s) => `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5)}`
  },
  {
    id: 'uk-utr',
    label: 'UK UTR',
    country: 'GB',
    typeId: 'taxId',
    fieldKey: 'Tax ID number',
    strength: 0,
    test: (s) => /^\d{10}$/.test(s)
  },
  {
    id: 'fr-spi',
    label: 'French tax number',
    country: 'FR',
    typeId: 'taxId',
    fieldKey: 'Tax ID number',
    strength: 0,
    test: (s) => /^[0-3]\d{12}$/.test(s)
  },
  {
    id: 'us-ssn',
    label: 'US Social Security number',
    country: 'US',
    typeId: 'socialSecurity',
    fieldKey: 'Social security number',
    strength: 2,
    test: (_s, raw) => /^(?!000|666|9)\d{3}[- ](?!00)\d{2}[- ](?!0000)\d{4}$/.test(raw.trim()),
    format: (s) => `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5)}`
  },
  {
    id: 'de-sv-nummer',
    label: 'German social insurance number',
    country: 'DE',
    typeId: 'socialSecurity',
    fieldKey: 'Social security number',
    strength: 3,
    test: svNummerValid,
    format: (s) => `${s.slice(0, 2)} ${s.slice(2, 8)} ${s[8]} ${s.slice(9)}`
  },
  {
    id: 'uk-nino',
    label: 'UK National Insurance number',
    country: 'GB',
    typeId: 'socialSecurity',
    fieldKey: 'Social security number',
    strength: 2,
    test: (s) => /^(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/.test(s),
    format: (s) => `${s.slice(0, 2)} ${s.slice(2, 4)} ${s.slice(4, 6)} ${s.slice(6, 8)} ${s[8]}`
  },
  {
    id: 'fr-nir',
    label: 'French social security number',
    country: 'FR',
    typeId: 'socialSecurity',
    fieldKey: 'Social security number',
    strength: 3,
    test: nirValid,
    format: (s) =>
      `${s[0]} ${s.slice(1, 3)} ${s.slice(3, 5)} ${s.slice(5, 7)} ${s.slice(7, 10)} ${s.slice(10, 13)} ${s.slice(13)}`
  },
  {
    id: 'nl-bsn',
    label: 'Dutch BSN',
    country: 'NL',
    typeId: 'socialSecurity',
    fieldKey: 'Social security number',
    strength: 3,
    test: bsnValid,
    format: (s) => s
  },
  {
    id: 'ch-ahv',
    label: 'Swiss AHV number',
    country: 'CH',
    typeId: 'socialSecurity',
    fieldKey: 'Social security number',
    strength: 3,
    test: (s) => s.startsWith('756') && ean13Valid(s),
    format: (s) => `${s.slice(0, 3)}.${s.slice(3, 7)}.${s.slice(7, 11)}.${s.slice(11)}`
  },
  {
    id: 'eu-vat',
    label: 'VAT number',
    typeId: 'vatId',
    fieldKey: 'VAT number',
    strength: 2,
    test: (s) => EU_VAT.test(s) && !ibanValid(s),
    format: (s) => s
  },
  {
    id: 'imei',
    label: 'IMEI',
    typeId: 'phone',
    fieldKey: 'IMEI',
    strength: 3,
    test: (s) => /^\d{15}$/.test(s) && luhnValid(s),
    format: (s) => s
  },
  {
    id: 'vin',
    label: 'Vehicle identification number',
    typeId: 'vehicle',
    fieldKey: 'VIN',
    strength: 1,
    test: (s) => /^[A-HJ-NPR-Z0-9]{17}$/.test(s) && /\d/.test(s) && /[A-Z]/.test(s),
    format: (s) => s
  },
  {
    id: 'email',
    label: 'Email address',
    typeId: 'emailAccount',
    fieldKey: 'UserName',
    strength: 2,
    test: (_s, raw) => EMAIL.test(raw.trim()),
    format: (_s, raw) => raw.trim()
  },
  {
    id: 'web',
    label: 'Website',
    typeId: LOGIN_TYPE,
    fieldKey: 'URL',
    strength: 1,
    test: (_s, raw) => WEB_ADDRESS.test(raw.trim()),
    format: (_s, raw) => (/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`)
  }
]

const FORMAT_BY_ID = new Map(ID_FORMATS.map((f) => [f.id, f]))

export const getIdFormat = (id: string): IdFormat | undefined => FORMAT_BY_ID.get(id)

export interface RecognizedId {
  format: IdFormat
  /** The value in the format's canonical spelling. */
  value: string
}

const formatValue = (f: IdFormat, raw: string) =>
  f.format ? f.format(compactId(raw), raw) : raw.trim()

/** Formats a typed query could be, most specific first. Ambiguous (strength 0) ones never match. */
export function recognizeId(query: string, limit = 3): RecognizedId[] {
  const raw = query.trim()
  if (raw.length < 5 || raw.length > 100) return []
  const compact = compactId(raw)
  // Ties go to the format whose canonical spelling is what the user typed (`2 55 08 …` is a NIR).
  const spelled = (r: RecognizedId) => (r.value === raw ? 1 : 0)
  return ID_FORMATS.filter((f) => f.strength > 0 && f.test(compact, raw))
    .map((format) => ({ format, value: formatValue(format, raw) }))
    .sort((a, b) => b.format.strength - a.format.strength || spelled(b) - spelled(a))
    .slice(0, limit)
}

/** The first of `field.formats` that `raw` matches, e.g. to show “German tax ID ✓”. */
export function fieldFormat(field: TypeField, raw: string): IdFormat | undefined {
  const v = raw.trim()
  if (!v || !field.formats) return undefined
  const compact = compactId(v)
  return field.formats
    .map((id) => FORMAT_BY_ID.get(id))
    .find((f) => f !== undefined && f.test(compact, v))
}

// ------------------------------------------------------ new-entry hints

export interface NewEntrySuggestion {
  typeId: string
  /** A recognised number, matching words, or (renderer side) the meaning via embeddings. */
  via: 'id' | 'keyword' | 'semantic'
  /** What was recognised, e.g. `German tax ID`. */
  detail?: string
  /** Field values for the new entry's form, keyed by field key. */
  prefill?: Record<string, string>
}

const STOPWORDS = new Set(
  'a an the my our your for of new add create mein meine meinen der die das den ein eine für neu neue neuer neues'.split(
    ' '
  )
)

const words = (s: string) =>
  fold(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

const TERMS = new Map(
  ENTRY_TYPES.map((t) => [t.id, new Set(words([t.label, ...(t.keywords ?? [])].join(' ')))])
)

/** 0 when some word doesn't match the type; otherwise higher for exact matches. */
function keywordScore(t: EntryType, query: string[]): number {
  const terms = TERMS.get(t.id)!
  let score = 0
  for (const w of query) {
    if (terms.has(w)) score += 2
    else if (w.length >= 3 && [...terms].some((term) => term.startsWith(w))) score += 1
    else return 0
  }
  return score
}

/** The prefill for a recognised number: the value, the format's extras and its country. */
function idPrefill({ format, value }: RecognizedId): Record<string, string> {
  const t = getType(format.typeId)
  const prefill: Record<string, string> = { [format.fieldKey]: value, ...format.extra }
  if (format.country && t?.fields.some((f) => f.key === 'Country')) prefill.Country = format.country
  if (format.id === 'eu-vat') prefill.Country = vatCountry(compactId(value))
  return prefill
}

/**
 * “Add …” suggestions for a search query: recognised numbers first (prefilled),
 * then types whose name or keywords match every word. Pure and instant; the
 * renderer adds semantic matches from main.
 */
export function suggestNewEntries(query: string, limit = 4): NewEntrySuggestion[] {
  const out: NewEntrySuggestion[] = []
  const seen = new Set<string>()
  for (const id of recognizeId(query)) {
    if (seen.has(id.format.typeId)) continue
    seen.add(id.format.typeId)
    out.push({
      typeId: id.format.typeId,
      via: 'id',
      detail: id.format.label,
      prefill: idPrefill(id)
    })
  }
  const q = words(query).filter((w) => !STOPWORDS.has(w))
  if (q.length && q.some((w) => w.length >= 2)) {
    ENTRY_TYPES.map((t) => ({ t, score: keywordScore(t, q) }))
      .filter((s) => s.score > 0 && !seen.has(s.t.id))
      .sort((a, b) => b.score - a.score)
      .forEach(({ t }) => {
        seen.add(t.id)
        out.push({ typeId: t.id, via: 'keyword' })
      })
  }
  return out.slice(0, limit)
}

/** The text the embedding model reads for a type, for semantic “Add …” suggestions. */
export function typePassage(t: EntryType): string {
  const group = ENTRY_TYPE_GROUPS.find((g) => g.id === t.group)?.label ?? ''
  return [t.label, group, (t.keywords ?? []).join(', '), t.fields.map((f) => f.label).join(', ')]
    .filter(Boolean)
    .join(' · ')
}
