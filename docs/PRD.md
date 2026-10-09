# Vehicle OS — Product Requirements Document

**Document:** `PRD.md`
**Version:** 1.0
**Status:** Product Definition
**Product:** Vehicle OS
**Platforms:** Web, iOS, Android
**Primary Architecture:** Next.js + React Native/Expo + Fastify + PostgreSQL

---

# 1. Product Overview

Vehicle OS is a cross-platform application for managing, organizing, understanding, and preserving the complete lifecycle of personal vehicles and movable assets.

The platform supports:

- Cars
- Motorcycles
- Scooters
- Bicycles
- Boats
- ATVs
- Trailers
- Vans
- RVs / caravans
- Other user-defined vehicle types

Vehicle OS is not intended to be merely a maintenance reminder application.

It is designed to become a **digital operating system for a person's garage**.

Every vehicle receives a persistent digital identity containing:

- Identity and specifications
- Ownership information
- Purchase information
- Maintenance history
- Repair history
- Tasks
- Expenses
- Parts and components
- Condition
- Photos
- Documents
- Modifications
- Ideas and future plans
- Market value
- Ownership cost
- Timeline
- Health
- Eventually, live telemetry and OBD data

The core product principle is:

> **Everything about your vehicles, in one place.**

The long-term product evolution is:

> Record → Organize → Understand → Predict → Connect.

---

# 2. Product Vision

## Vision

Create the world's most useful digital identity and management platform for personal vehicles.

A user should be able to open Vehicle OS years after purchasing a vehicle and understand virtually everything about its life.

The application should answer:

- What is this vehicle?
- When did I buy it?
- How much did I pay?
- What has been done to it?
- What needs to be done?
- What has it cost me?
- What condition is it in?
- What parts are installed?
- What modifications have I made?
- What documents exist?
- What is it worth?
- What should I do next?
- What happened to it over its lifetime?

Eventually:

> The vehicle should be able to tell the owner what is happening and what needs attention.

---

# 3. Product Mission

Vehicle OS exists to eliminate fragmented vehicle ownership information.

Today, vehicle information is usually scattered across:

- Paper invoices
- Email
- WhatsApp
- Photos
- Notes apps
- Spreadsheets
- Manufacturer portals
- Mechanic records
- Marketplace listings
- Insurance documents
- Memory

Vehicle OS consolidates this information into one structured, searchable, intelligent system.

---

# 4. Problem Statement

Vehicle owners often lack a reliable, centralized record of their vehicle's life.

Common problems include:

1. Forgetting when maintenance was performed.
2. Losing service invoices.
3. Not knowing total ownership cost.
4. Not knowing which parts were installed.
5. Forgetting upcoming maintenance.
6. Losing track of modifications and ideas.
7. Having incomplete resale documentation.
8. Not knowing current market value.
9. Having no structured condition history.
10. Having information spread across multiple vehicles and family members.
11. Having no unified view of a vehicle's complete history.
12. Manually maintaining spreadsheets that become outdated.
13. Receiving generic maintenance reminders without context.
14. Being unable to easily communicate complete vehicle history to a mechanic or buyer.

---

# 5. Product Opportunity

Vehicle OS can differentiate by combining:

- Garage management
- Vehicle digital identity
- Maintenance
- Timeline
- Expenses
- Parts
- Documents
- Condition
- Valuation
- Tasks
- Vehicle intelligence
- Future telemetry

into a single platform.

The product should feel closer to:

> **A personal digital garage**

than:

> **A maintenance checklist.**

---

# 6. Product Principles

## 6.1 Vehicle-first

The vehicle is the primary object in the system.

Everything else relates to it.

## 6.2 History is sacred

Every meaningful action should be recordable and preserved.

## 6.3 Progressive complexity

Users should not need to enter dozens of fields when adding a vehicle.

Start simple and progressively enrich the vehicle profile.

## 6.4 Automation over manual entry

Where possible, use:

- VIN decoding
- OCR
- integrations
- telemetry
- smart defaults
- recurring schedules
- automatic calculations

## 6.5 Data is the source of truth

AI should interpret and assist with user data, not replace structured data.

## 6.6 Mobile for action

Mobile should optimize for:

- quick entry
- photos
- reminders
- checking tasks
- recording events

## 6.7 Web for depth

Web should optimize for:

- analytics
- history
- documents
- collection management
- comparisons
- bulk operations

## 6.8 Beautiful by default

Vehicle ownership is emotional.

The application should feel premium, visual, personal, and rewarding.

---

# 7. Target Users

## 7.1 Casual Vehicle Owner

Owns one or two vehicles.

Primary needs:

- Maintenance reminders
- Service history
- Documents
- Expenses
- Vehicle information

## 7.2 Enthusiast

Owns vehicles as hobbies or projects.

Needs:

- Modifications
- Parts
- Build plans
- Photos
- Detailed history
- Vehicle condition
- Costs
- Showcase
- Vehicle Passport

## 7.3 Collector

Owns multiple valuable vehicles.

Needs:

- Collection management
- Valuations
- Detailed history
- Documentation
- Condition
- Ownership costs
- Resale documentation

## 7.4 Family / Household

Multiple people manage multiple vehicles.

Needs:

- Shared garage
- Members
- Permissions
- Shared tasks
- Shared expenses
- Vehicle responsibility

## 7.5 Mechanic / Service Provider

Potential future persona.

Needs:

- Customer vehicle history
- Service records
- Work orders
- Parts
- Inspection reports
- Digital service handoff

---

# 8. Core Product Concepts

The application is built around several foundational objects.

```text
User
  ↓
Garage
  ↓
Vehicle
  ├── Events
  ├── Maintenance
  ├── Tasks
  ├── Components
  ├── Expenses
  ├── Documents
  ├── Photos
  ├── Condition
  ├── Valuations
  ├── Ideas
  └── Telemetry
```

---

# 9. Vehicle

A Vehicle represents any supported movable asset.

## Core fields

- ID
- Type
- Make
- Model
- Year
- Variant
- Name
- VIN / frame number / hull identification
- Registration number
- Color
- Purchase date
- Purchase price
- Current mileage
- Engine hours where applicable
- Current estimated value
- Currency
- Location
- Primary photo
- Created date
- Updated date

## Type-specific information

The system should support type-specific specifications without forcing every vehicle into the same schema.

Examples:

### Car

- Engine
- Transmission
- Fuel type
- Displacement
- Horsepower
- Tire sizes
- Battery
- Oil capacity

### Motorcycle

- Engine
- Chain
- Sprockets
- Tire sizes
- Suspension
- Engine hours

### Bicycle

- Frame
- Frame size
- Groupset
- Wheelset
- Suspension
- Brake system

### Boat

- Hull type
- Engine
- Engine hours
- Propeller
- Trailer
- Mooring information

---

# 10. Garage

A Garage is a user's collection/container of vehicles.

A user may have multiple garages.

Examples:

- My Garage
- Family Garage
- Classic Collection
- Project Vehicles

A Garage contains:

- Vehicles
- Members
- Garage-level settings
- Garage activity
- Garage analytics

---

# 11. Garage Members

A Garage can have multiple users.

Roles:

### Owner

Full access.

### Admin

Can manage vehicles and members.

### Member

Can view and modify permitted vehicles.

### Driver

Can record activity but has restricted administrative access.

### Viewer

Read-only access.

Permissions should eventually support vehicle-level restrictions.

---

# 12. Vehicle Timeline

The Timeline is one of the primary product features.

Every meaningful vehicle event appears chronologically.

Examples:

- Purchase
- Maintenance
- Repair
- Modification
- Inspection
- Accident
- Fuel
- Charging
- Cleaning
- Expense
- Registration
- Insurance
- Trip
- Note
- Component replacement

Example:

```text
2026

SEP 03
Oil + Filter
42,381 km
$180

AUG 21
Tire replacement
42,000 km
$1,240

JUL 12
Ceramic coating
$650

JUN 03
Headlight replacement
$420
```

The timeline should become the vehicle's **digital biography**.

---

# 13. Event Model

An Event represents something that happened to a vehicle.

Common fields:

- ID
- Vehicle ID
- Event type
- Title
- Description
- Date
- Odometer
- Engine hours
- Cost
- Currency
- Provider
- Parts
- Attachments
- Created by
- Created at
- Updated at

Events should be extensible.

---

# 14. Maintenance

Maintenance represents scheduled or completed servicing.

## Maintenance Plan

Defines:

- Task
- Interval by distance
- Interval by time
- Interval by engine hours
- Previous completion
- Next due
- Priority
- Vehicle
- Notes

Example:

```text
Engine Oil

Every 10,000 km
OR
Every 12 months

whichever comes first
```

## Maintenance Record

Records actual completion.

Fields:

- Date
- Mileage
- Engine hours
- Work performed
- Parts
- Labor
- Cost
- Provider
- Notes
- Attachments
- Next recommended service

---

# 15. Tasks

Tasks represent actions the user needs or wants to perform.

Task categories:

- Maintenance
- Repair
- Administrative
- Purchase
- Modification
- Cleaning
- Inspection
- Research
- Idea

Task fields:

- Title
- Description
- Vehicle
- Due date
- Due mileage
- Priority
- Status
- Category
- Assignee
- Estimated cost
- Actual cost
- Attachments

Statuses:

```text
Inbox
Planned
In Progress
Waiting
Completed
Cancelled
```

---

# 16. Ideas / Build Plans

Ideas are non-urgent future plans.

Examples:

- New wheels
- Exhaust
- Dashcam
- Roof rack
- Ceramic coating
- Suspension
- New groupset

Lifecycle:

```text
Idea
 ↓
Research
 ↓
Planned
 ↓
Ordered
 ↓
Installed
 ↓
History
```

Ideas may optionally become Tasks.

---

# 17. Components and Parts

A Vehicle may contain Components.

Examples:

```text
Engine
 ├── Oil
 ├── Oil Filter
 ├── Air Filter
 └── Spark Plugs

Brakes
 ├── Front Pads
 ├── Front Rotors
 ├── Rear Pads
 └── Rear Rotors

Wheels
 ├── Wheels
 └── Tires
```

Components can maintain their own:

- Installation date
- Removal date
- Mileage
- Cost
- Brand
- Model
- Part number
- Warranty
- Position
- Condition
- History

This is particularly important for enthusiasts.

---

# 18. Expenses

Every relevant expense should be associated with a vehicle.

Expense categories:

- Purchase
- Maintenance
- Repair
- Fuel
- Charging
- Insurance
- Registration
- Parts
- Accessories
- Modifications
- Cleaning
- Storage
- Transport
- Other

The system calculates:

### Total spent

### Total ownership cost

### Annual cost

### Cost per kilometer/mile

### Maintenance cost

### Modification cost

### Fuel/energy cost

---

# 19. Vehicle Value

Users can record:

- Purchase price
- Current estimated value
- Historical valuations
- Sale price
- Currency

The platform should eventually support external valuation providers.

The application should display:

```text
Purchase
$57,000

Current Value
$48,500

Total Invested
$67,840
```

Value tracking should support historical charts.

---

# 20. Condition

Users can record vehicle condition.

Categories:

- Exterior
- Interior
- Mechanical
- Electrical
- Tires
- Brakes
- Body
- Frame/Hull
- Other

A condition assessment may contain:

- Score
- Notes
- Photos
- Damage
- Date
- Assessor

The system can maintain a condition history.

Future AI capability:

> Detect changes between condition photos.

---

# 21. Documents

Supported documents include:

- Registration
- Insurance
- Purchase agreement
- Service invoices
- Repair invoices
- Inspection reports
- Warranty documents
- Manuals
- Receipts
- Import documents
- Modification certificates

Documents must be associated with a vehicle and optionally an event.

---

# 22. Photos

Photos should support:

- Vehicle gallery
- Condition photos
- Damage photos
- Service photos
- Component photos
- Modification photos
- Receipts
- Documents

Photos may optionally be attached to events.

---

# 23. Vehicle Passport

The Vehicle Passport is a shareable summary of a vehicle's life.

It should contain:

- Identity
- Ownership timeline
- Mileage
- Maintenance history
- Major repairs
- Modifications
- Condition
- Documentation
- Total investment
- Current value

The Passport should be exportable as PDF.

Potential use:

> Provide the next owner with the complete history of the vehicle.

---

# 24. Vehicle Health

Vehicle Health is a calculated score representing the current state of the vehicle.

Initial health may be calculated from:

- Maintenance status
- Overdue tasks
- Condition
- Documentation
- Component status
- Known issues

Example:

```text
Vehicle Health
92 / 100

Maintenance       98
Mechanical        94
Exterior          82
Interior          91
Tires             97
Documentation    100
```

The algorithm should be versioned so it can evolve without corrupting historical scores.

Future inputs:

- OBD
- Diagnostic codes
- Telemetry
- Sensor readings

---

# 25. Dashboard

The Home Dashboard should answer:

> What is happening with my garage right now?

Primary sections:

### Garage Summary

- Number of vehicles
- Total estimated value
- Total ownership cost
- Health summary

### Attention Required

- Overdue maintenance
- Upcoming maintenance
- Expiring documents
- High-priority tasks

### Recent Activity

- Recent maintenance
- Expenses
- Mileage
- Vehicle updates

### Garage Briefing

A concise summary such as:

```text
Your garage is healthy.

1 maintenance item needs attention.
2 documents expire this month.
You spent $740 this month.
Garage value is up $2,300 since January.
```

---

# 26. Vehicle Profile

Vehicle Profile is the central screen for a vehicle.

Primary header:

```text
[Vehicle Image]

BMW M3 Competition
2021

42,381 km

Health
92 / 100

Value
$48,500
```

Primary navigation:

```text
Overview
Timeline
Maintenance
Tasks
Costs
Parts
Documents
Photos
Condition
Ideas
```

Additional sections can appear depending on vehicle type.

---

# 27. Garage View

The Garage View displays all vehicles as a collection.

Each vehicle card should show:

- Image
- Name
- Type
- Mileage
- Health
- Value
- Important pending task

Example:

```text
BMW M3
42,381 km
Health 92
$48,500

MT-09
8,240 km
Health 87

Trek
1,420 km
Health 96
```

The interface should feel like a premium digital garage.

---

# 28. Global Activity

Users should be able to see activity across all vehicles.

Example:

```text
Today

BMW M3
Oil service
$180

Trek
42 km ride

MT-09
Registration reminder

Yesterday

BMW M3
New tire expense
$1,240
```

Filters:

- Vehicle
- Event type
- Date
- Cost
- Member

---

# 29. Global Tasks

A consolidated task center should show:

```text
OVERDUE
3

TODAY
1

THIS WEEK
4

UPCOMING
8
```

Tasks should be sortable by:

- Priority
- Vehicle
- Due date
- Category
- Assignee

---

# 30. Search

Global search should search across the entire garage.

Examples:

```text
brakes
```

returns:

- Brake maintenance records
- Brake parts
- Brake-related tasks
- Brake documents
- Brake notes

Search should eventually support natural language.

Example:

> How much have I spent on tires?

The system should retrieve structured data and provide a trustworthy answer.

---

# 31. Notifications

Notifications should be contextual rather than noisy.

Examples:

### Maintenance

> BMW M3 is 1,200 km from its scheduled oil service.

### Document

> MT-09 insurance expires in 18 days.

### Task

> Rear tire replacement is overdue.

### Garage Briefing

A weekly summary of important garage activity.

Notification channels:

- Push
- Email
- In-app

SMS may be considered later.

---

# 32. Onboarding

Onboarding should minimize friction.

## Step 1

```text
What are we adding?

Car
Motorcycle
Bicycle
Boat
Scooter
ATV
Other
```

## Step 2

Ask for VIN/frame/hull identifier where applicable.

## Step 3

Decode vehicle information where possible.

## Step 4

Ask:

- Purchase date
- Purchase price
- Current mileage

## Step 5

Ask user to add a photo.

## Step 6

Create vehicle.

The user should reach a useful vehicle dashboard within minutes.

Additional data can be collected progressively.

---

# 33. Quick Add

The application should support rapid event creation.

A global "+" action should offer:

```text
Maintenance
Expense
Task
Fuel
Trip
Photo
Document
Note
Modification
Condition
```

The user should be able to record a basic event in seconds.

---

# 34. OCR and Intelligent Import

Users should be able to photograph an invoice.

The system extracts:

- Date
- Vehicle
- Mileage
- Provider
- Service
- Parts
- Labor
- Tax
- Total

The user reviews the extracted information before saving.

No AI-generated information should be silently committed as factual data.

---

# 35. AI Vehicle Intelligence

AI is a supporting intelligence layer.

Potential capabilities:

### Natural language queries

> How much did I spend on my BMW this year?

### Maintenance explanations

> Why is this service due?

### Document extraction

> Turn this invoice into a service record.

### Insights

> Your maintenance spending increased 28% this year.

### Recommendations

> Based on your recorded service history, these items may need attention soon.

AI responses must distinguish:

- User-recorded facts
- Calculated values
- External information
- AI suggestions

---

# 36. OBD / Connected Vehicle

OBD is explicitly a future capability.

The application should eventually support:

- Bluetooth OBD adapters
- Diagnostic codes
- RPM
- Coolant temperature
- Battery voltage
- Engine load
- Other supported telemetry

Telemetry should feed the same vehicle intelligence system.

Example:

```text
OBD
 ↓
Telemetry
 ↓
Vehicle Health
 ↓
Insights
 ↓
Task / Notification
```

Example:

> Battery voltage has been consistently lower than expected. Consider checking the battery or charging system.

All safety-critical recommendations should be presented as suggestions, not definitive mechanical diagnoses.

---

# 37. Service Provider Integration

Future functionality may allow mechanics to contribute directly to vehicle records.

Workflow:

```text
Owner
 ↓
Shares vehicle with mechanic
 ↓
Mechanic performs service
 ↓
Mechanic records work
 ↓
Owner approves
 ↓
Permanent vehicle history
```

This can eliminate paper-based service history.

---

# 38. Sharing

Users should be able to share:

- Entire garage
- Individual vehicle
- Vehicle Passport
- Specific event
- Service history
- Documents

Share links should support expiration and revocation.

---

# 39. Resale

Vehicle OS should eventually support a resale workflow.

```text
Vehicle
 ↓
Generate Passport
 ↓
Generate condition report
 ↓
Generate ownership cost
 ↓
Generate service history
 ↓
Export
```

Potential future:

> Create a verified vehicle listing.

---

# 40. Future Marketplace

Potential future integrations:

- Parts
- Accessories
- Service providers
- Insurance
- Valuation
- Vehicle marketplaces

Marketplace features are explicitly outside the initial MVP.

---

# 41. Web Requirements

The web application should be optimized for desktop/tablet workflows.

Priority capabilities:

- Garage dashboard
- Vehicle management
- Timeline
- Maintenance
- Expense analytics
- Document management
- Vehicle comparison
- Collection view
- Passport generation

Desktop should support efficient bulk operations.

---

# 42. Mobile Requirements

Mobile is the primary on-the-go interface.

Priority capabilities:

- Dashboard
- Vehicle profiles
- Quick Add
- Camera
- Documents
- Tasks
- Maintenance
- Notifications
- Timeline

The mobile application should feel native rather than like a responsive website.

---

# 43. Responsive Design

The product should support:

- Mobile portrait
- Mobile landscape
- Tablet
- Laptop
- Desktop

Web and mobile can use different layouts while sharing product concepts and visual language.

---

# 44. Accessibility

The product must target WCAG 2.2 AA for web interfaces where practical.

Requirements include:

- Keyboard navigation
- Screen reader support
- Accessible labels
- Sufficient contrast
- Focus states
- Reduced-motion support
- Proper semantic structure
- Touch targets of appropriate size

---

# 45. Localization

The application should be architected for localization from the beginning.

Potential localization dimensions:

- Language
- Currency
- Distance units
- Volume units
- Temperature
- Date formats
- Number formats

Initial release may launch in English only.

---

# 46. Units

Distance:

- km
- miles

Fuel:

- liters
- gallons

Temperature:

- Celsius
- Fahrenheit

Currency should be user-selectable and stored explicitly on financial records.

---

# 47. Security Requirements

The system must enforce strict tenant isolation.

A user must only access:

- Their own account
- Garages they belong to
- Vehicles accessible through those garages

Authorization must be enforced server-side.

The frontend must never be considered a security boundary.

Sensitive operations must be authorized independently.

---

# 48. Data Ownership

Users should be able to:

- Export their data
- Download documents
- Export vehicle history
- Delete vehicles
- Delete their account

Deletion behavior must be explicitly defined.

Vehicle Passport exports should contain only information selected for sharing.

---

# 49. Auditability

Important operations should be auditable.

Examples:

- Vehicle created
- Vehicle deleted
- Expense changed
- Maintenance record changed
- Member added
- Member removed
- Document uploaded
- Passport generated

Audit logging is especially important for shared garages.

---

# 50. Performance Requirements

Initial targets:

### Web

- Fast first meaningful render
- Responsive interactions
- Avoid unnecessary page reloads

### API

Target typical CRUD requests:

```text
p50 < 150ms
p95 < 500ms
```

excluding external services.

### Mobile

- Fast launch
- Smooth scrolling
- Smooth timeline interaction
- Optimized image loading

These are targets, not absolute guarantees.

---

# 51. Reliability

Target:

> 99.9% monthly availability for production API infrastructure once the product reaches paid production scale.

Critical operations should be:

- Idempotent where appropriate
- Retryable
- Logged
- Observable

Background jobs must support retry and failure states.

---

# 52. Offline Capability

Offline support should be considered an architectural requirement.

Initial MVP may provide limited offline support for selected workflows.

Future full offline support should allow:

- Viewing recently accessed vehicles
- Creating events
- Creating tasks
- Taking photos
- Updating mileage

Data should synchronize when connectivity returns.

Conflict resolution rules must be defined before full offline implementation.

---

# 53. Analytics

Product analytics should measure behavior without collecting unnecessary personal information.

Important events:

```text
user_registered
garage_created
vehicle_created
vehicle_completed
event_created
maintenance_created
task_created
task_completed
expense_created
document_uploaded
receipt_scanned
passport_generated
vehicle_shared
subscription_started
```

---

# 54. Core Success Metrics

## Activation

Percentage of new users who:

1. Create a garage.
2. Add a vehicle.
3. Complete the basic vehicle profile.
4. Record their first event.

## Engagement

- Weekly active users
- Monthly active users
- Vehicles per active user
- Events per vehicle
- Tasks completed

## Retention

- D7
- D30
- D90

## Product value

- Percentage of vehicles with recorded history
- Documents stored
- Maintenance records created
- Tasks completed
- Passport exports

## Monetization

- Free → Pro conversion
- Monthly recurring revenue
- Annual recurring revenue
- Churn
- Revenue per active paid user

---

# 55. MVP Scope

The MVP must establish the core digital garage.

## Included

### Authentication

- Registration
- Login
- Logout
- Password reset
- Basic profile

### Garage

- Create garage
- Rename garage
- Delete garage
- Add vehicle

### Vehicles

- Multiple vehicle types
- Basic specifications
- Purchase information
- Mileage
- Photos

### Timeline

- Create event
- Edit event
- Delete event
- Event categories
- Attachments
- Mileage

### Maintenance

- Maintenance plans
- Due dates
- Mileage intervals
- Maintenance history
- Reminders

### Tasks

- Create
- Edit
- Complete
- Delete
- Priority
- Due date

### Expenses

- Record expense
- Categories
- Total spending
- Vehicle spending

### Documents

- Upload
- View
- Delete
- Associate with vehicle/event

### Dashboard

- Garage summary
- Attention required
- Recent activity

### Search

- Basic global search

---

# 56. MVP Exclusions

Do not include in the first release:

- OBD
- Mechanic marketplace
- Parts marketplace
- Social network
- Advanced AI assistant
- Predictive maintenance
- Automated market valuation
- Complex vehicle telemetry
- Public vehicle listings
- Advanced fleet management
- Full accounting
- Insurance integration

These are future capabilities.

---

# 57. V1.5

After MVP validation:

- OCR invoice extraction
- Vehicle Passport
- Condition tracking
- Advanced expenses
- Historical value tracking
- Garage sharing
- Better search
- Garage Briefing
- Advanced notifications

---

# 58. V2

- AI Vehicle Intelligence
- Natural language queries
- Advanced analytics
- Component/parts tracking
- Marketplace integrations
- VIN enrichment
- External valuations
- Service provider workflows

---

# 59. V3

- OBD
- Bluetooth telemetry
- Diagnostic codes
- Predictive maintenance
- Connected vehicle integrations
- Mechanic platform
- Vehicle resale ecosystem

---

# 60. Monetization

Potential model:

## Free

- Limited number of vehicles
- Basic timeline
- Basic maintenance
- Basic tasks
- Basic expenses

## Pro

- Unlimited vehicles
- Documents
- Advanced analytics
- Vehicle Passport
- Condition tracking
- AI features
- Advanced history
- Garage sharing
- Cloud backup

## Connected

Future premium tier:

- OBD
- Telemetry
- Advanced vehicle intelligence
- Predictive maintenance

Pricing should be validated after MVP usage data exists.

---

# 61. Non-Goals

Vehicle OS is not initially:

- A mechanic diagnostic replacement
- A fleet management platform
- An insurance provider
- An accounting platform
- A vehicle marketplace
- A social network
- A replacement for manufacturer systems

The application should remain focused on **personal vehicle ownership and organization**.

---

# 62. Risks

## Risk: Too much complexity

Mitigation:

- Progressive onboarding
- Modular feature design
- Strong MVP scope

## Risk: Manual data entry fatigue

Mitigation:

- Quick Add
- OCR
- VIN decoding
- Automation
- Future telemetry

## Risk: Users don't return frequently

Mitigation:

- Maintenance reminders
- Garage Briefing
- Value tracking
- Tasks
- Vehicle intelligence

## Risk: Incorrect AI recommendations

Mitigation:

- AI does not become source of truth
- Clearly label suggestions
- Require confirmation for extracted records
- Use structured data whenever possible

## Risk: Storage costs

Mitigation:

- Image resizing
- Compression
- Object storage
- Lifecycle policies
- Storage quotas

## Risk: OBD complexity

Mitigation:

- Build telemetry abstraction early
- Delay actual OBD implementation
- Start with a limited supported adapter set

---

# 63. UX Philosophy

Vehicle OS should feel:

- Premium
- Calm
- Visual
- Intelligent
- Personal
- Fast
- Trustworthy

It should avoid feeling:

- Corporate
- Overly technical
- Spreadsheet-like
- Notification-heavy
- Cluttered

The visual identity should combine:

- Automotive instrumentation
- Modern software design
- Digital garage aesthetics
- High-quality photography
- Data visualization

---

# 64. Core UX Loop

```text
ADD VEHICLE
     ↓
BUILD PROFILE
     ↓
RECORD EVENTS
     ↓
MAINTAIN
     ↓
TRACK COST
     ↓
TRACK CONDITION
     ↓
PLAN FUTURE
     ↓
UNDERSTAND VEHICLE
     ↓
CONNECT VEHICLE
```

---

# 65. Product Flywheel

```text
More vehicles
      ↓
More history
      ↓
More structured data
      ↓
Better insights
      ↓
More useful reminders
      ↓
Higher retention
      ↓
More history
```

Later:

```text
More connected vehicles
      ↓
More telemetry
      ↓
Better vehicle intelligence
      ↓
More proactive recommendations
```

---

# 66. Key Product Differentiator

The product's strongest differentiator should be:

> **The vehicle's complete digital life.**

Not just maintenance.

Not just expenses.

Not just documents.

Not just telemetry.

All of them connected to the same vehicle identity.

---

# 67. Example End-to-End User Journey

A user purchases a BMW M3.

### Day 1

Adds vehicle.

System identifies:

```text
2021 BMW M3 Competition
```

User enters:

```text
Purchase:
$57,000

Mileage:
36,000 km
```

Uploads purchase document.

### Month 2

User performs oil service.

Takes photo of invoice.

Future OCR extracts the service.

The event is added to the timeline.

### Month 5

User creates:

```text
Idea:
Install new wheels
```

### Month 6

User adds expense:

```text
Michelin tires
$1,240
```

The tire component is updated.

### Month 8

Maintenance reminder appears.

### Month 12

Vehicle Passport shows:

```text
Ownership:
1 year

Total spent:
$63,400

Maintenance:
$2,240

Modifications:
$1,800

Mileage:
42,381 km

Health:
92
```

This is the core experience.

---

# 68. Definition of MVP Success

The MVP is successful if a user can:

1. Create an account.
2. Create a garage.
3. Add multiple vehicle types.
4. Build a basic vehicle profile.
5. Record a maintenance event.
6. Record an expense.
7. Create a task.
8. Schedule maintenance.
9. Upload a document/photo.
10. View the vehicle timeline.
11. Understand upcoming work.
12. Understand basic vehicle spending.
13. Return later and immediately understand the state of their garage.

---

# 69. Acceptance Criteria — Vehicle

A user can:

- Create a vehicle.
- Edit vehicle information.
- Upload a primary photo.
- Add multiple photos.
- Record mileage.
- Record purchase information.
- Archive/delete a vehicle.
- View the vehicle profile.
- View vehicle history.

---

# 70. Acceptance Criteria — Events

A user can:

- Create an event.
- Select event type.
- Add date.
- Add mileage.
- Add cost.
- Add notes.
- Attach photos/documents.
- Edit event.
- Delete event.
- View event in timeline.

---

# 71. Acceptance Criteria — Maintenance

A user can:

- Create a recurring maintenance item.
- Configure distance interval.
- Configure time interval.
- Mark maintenance complete.
- Automatically calculate next due date/mileage.
- View maintenance history.
- Receive reminders.

---

# 72. Acceptance Criteria — Tasks

A user can:

- Create task.
- Set priority.
- Set due date.
- Associate vehicle.
- Mark complete.
- Edit task.
- Filter tasks.

---

# 73. Acceptance Criteria — Expenses

A user can:

- Create expense.
- Categorize expense.
- Assign vehicle.
- Add date.
- Add amount.
- Add currency.
- View vehicle spending.
- View total garage spending.

---

# 74. Acceptance Criteria — Documents

A user can:

- Upload a document.
- Associate it with a vehicle.
- Associate it with an event.
- View document.
- Delete document.

---

# 75. Acceptance Criteria — Security

A user must never be able to access another user's garage or vehicle through:

- API manipulation
- URL manipulation
- Client-side modification
- Direct object ID access

All authorization must be enforced server-side.

---

# 76. Architecture Constraints

The product must use:

- TypeScript
- Fastify
- PostgreSQL
- Next.js
- React Native
- Expo

The backend should be a modular monolith initially.

The application should not start as microservices.

The database should remain the source of truth.

AI should remain an application capability rather than the system of record.

---

# 77. Technical Product Requirements

The system must support:

- REST API
- Authentication
- Authorization
- Multi-tenant garage model
- File uploads
- Background jobs
- Notifications
- Search
- Audit logs
- Analytics
- API versioning

The system should be designed to support:

- Offline mobile workflows
- OBD
- AI
- External APIs
- Marketplace integrations
- Mechanic accounts

---

# 78. API Principles

The API must:

- Be versioned.
- Return predictable structures.
- Validate inputs.
- Validate outputs where appropriate.
- Return meaningful error codes.
- Enforce authorization.
- Support pagination.
- Support filtering.
- Support sorting.
- Be idempotent where appropriate.

Initial API version:

```text
/v1
```

---

# 79. Data Principles

All important financial records must store:

- Amount
- Currency
- Date

All mileage-sensitive records should support:

- Odometer
- Unit

Engine-based vehicles should optionally support:

- Engine hours

The system must never silently convert or discard the original value.

---

# 80. Future Compatibility

The data model must be extensible enough to support:

- OBD
- GPS
- Manufacturer APIs
- EV telemetry
- Charging data
- External valuation data
- Mechanic records
- Marketplace data

without requiring a complete rewrite.

---

# 81. Product North Star

The ultimate product goal is:

> **Give every vehicle a complete, living digital identity.**

A vehicle should not merely exist as:

```text
Make + Model + VIN
```

It should exist as:

```text
Identity
+
Ownership
+
History
+
Maintenance
+
Components
+
Condition
+
Cost
+
Value
+
Documents
+
Plans
+
Telemetry
+
Intelligence
```

That is Vehicle OS.

---

# 82. Final Product Definition

Vehicle OS is a **personal vehicle operating system and digital garage**.

Its initial purpose is to help people organize everything related to their vehicles.

Its long-term purpose is to become the intelligent layer connecting:

```text
OWNER
   ↓
GARAGE
   ↓
VEHICLES
   ↓
HISTORY
   ↓
COMPONENTS
   ↓
MAINTENANCE
   ↓
COST
   ↓
CONDITION
   ↓
VALUE
   ↓
TELEMETRY
   ↓
INTELLIGENCE
   ↓
SERVICES
```

The product should begin as a simple, beautiful way to organize vehicle ownership and evolve into a connected platform that understands the complete life of every vehicle.

**Product principle:**

> **Your vehicles. Their entire story. One place.**
