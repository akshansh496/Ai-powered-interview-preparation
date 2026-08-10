# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: interview.spec.js >> Interview Preparation App E2E Tests >> should display dynamic loading messages when generating strategy and handle success
- Location: tests/interview.spec.js:33:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.recent-reports')
Expected substring: "Recent Plan"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for locator('.recent-reports')

```

```yaml
- main:
  - heading "Loading Dashboard" [level=2]
  - paragraph: Retrieving your recent interview preparation plans...
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | test.describe('Interview Preparation App E2E Tests', () => {
  4   | 
  5   |   test.beforeEach(async ({ page }) => {
  6   |     // Intercept auth session check
  7   |     await page.route('**/api/auth/me', async (route) => {
  8   |       await route.fulfill({
  9   |         status: 200,
  10  |         contentType: 'application/json',
  11  |         body: JSON.stringify({ user: { username: 'testuser', email: 'test@example.com' } }),
  12  |       });
  13  |     });
  14  | 
  15  |     // Intercept fetch dashboard reports
  16  |     await page.route('**/api/interview/', async (route, request) => {
  17  |       if (request.method() === 'GET') {
  18  |         await route.fulfill({
  19  |           status: 200,
  20  |           contentType: 'application/json',
  21  |           body: JSON.stringify({
  22  |             interviewReports: [
  23  |               { _id: '1', title: 'Recent Plan', matchScore: 85, createdAt: new Date().toISOString() }
  24  |             ]
  25  |           }),
  26  |         });
  27  |       } else {
  28  |         await route.fallback();
  29  |       }
  30  |     });
  31  |   });
  32  | 
  33  |   test('should display dynamic loading messages when generating strategy and handle success', async ({ page }) => {
  34  |     // Intercept generate report request
  35  |     await page.route('**/api/interview/', async (route, request) => {
  36  |       if (request.method() === 'POST') {
  37  |         // Delay response to capture loading state
  38  |         await new Promise(resolve => setTimeout(resolve, 500));
  39  |         await route.fulfill({
  40  |           status: 201,
  41  |           contentType: 'application/json',
  42  |           body: JSON.stringify({
  43  |             interviewReport: { _id: '2', title: 'New Plan', matchScore: 90 }
  44  |           }),
  45  |         });
  46  |       }
  47  |     });
  48  | 
  49  |     await page.goto('/');
  50  |     
  51  |     // Check main elements are visible
  52  |     await expect(page.locator('h1')).toContainText('Create Your Custom Interview Plan');
> 53  |     await expect(page.locator('.recent-reports')).toContainText('Recent Plan');
      |                                                   ^ Error: expect(locator).toContainText(expected) failed
  54  | 
  55  |     // Fill out form
  56  |     await page.fill('.panel--left textarea', 'Senior Software Engineer with React');
  57  |     await page.fill('.self-description textarea', '5 years of frontend experience');
  58  | 
  59  |     // Click generate button
  60  |     await page.click('.generate-btn');
  61  | 
  62  |     // Check custom loader text is showing
  63  |     const loadingText = page.locator('.loading-text h2');
  64  |     const loadingSubText = page.locator('.loading-text p');
  65  |     await expect(loadingText).toHaveText('Generating Strategy');
  66  |     await expect(loadingSubText).toHaveText('Analyzing job description and preparing your custom questions...');
  67  |   });
  68  | 
  69  |   test('should display error screen if strategy generation fails', async ({ page }) => {
  70  |     // Intercept generate report request to throw error
  71  |     await page.route('**/api/interview/', async (route, request) => {
  72  |       if (request.method() === 'POST') {
  73  |         await route.fulfill({
  74  |           status: 500,
  75  |           contentType: 'application/json',
  76  |           body: JSON.stringify({
  77  |             message: 'Server failed to process job description.'
  78  |           }),
  79  |         });
  80  |       }
  81  |     });
  82  | 
  83  |     await page.goto('/');
  84  |     await page.fill('.panel--left textarea', 'fail');
  85  |     await page.fill('.self-description textarea', 'fail');
  86  |     await page.click('.generate-btn');
  87  | 
  88  |     // Check custom error screen
  89  |     await expect(page.locator('.error-screen h2')).toHaveText('Something Went Wrong');
  90  |     await expect(page.locator('.error-screen p')).toContainText('Server failed to process job description.');
  91  | 
  92  |     // Click Try Again to go back to inputs
  93  |     await page.click('.error-actions button');
  94  |     await expect(page.locator('h1')).toContainText('Create Your Custom');
  95  |   });
  96  | 
  97  |   test('should display dynamic loading message when downloading resume', async ({ page }) => {
  98  |     // Intercept report details
  99  |     await page.route('**/api/interview/report/2', async (route) => {
  100 |       await route.fulfill({
  101 |         status: 200,
  102 |         contentType: 'application/json',
  103 |         body: JSON.stringify({
  104 |           interviewReport: {
  105 |             _id: '2',
  106 |             title: 'New Plan',
  107 |             matchScore: 90,
  108 |             technicalQuestions: [{ question: 'Q1?', intention: 'I1', answer: 'A1' }],
  109 |             behavioralQuestions: [{ question: 'BQ1?', intention: 'I1', answer: 'A1' }],
  110 |             preparationPlan: [{ day: 1, focus: 'F1', tasks: ['T1'] }],
  111 |             skillGaps: [{ skill: 'S1', severity: 'high' }]
  112 |           }
  113 |         }),
  114 |       });
  115 |     });
  116 | 
  117 |     // Intercept resume download to delay and return dummy HTML
  118 |     await page.route('**/api/interview/resume/pdf/2', async (route) => {
  119 |       await new Promise(resolve => setTimeout(resolve, 500));
  120 |       await route.fulfill({
  121 |         status: 200,
  122 |         contentType: 'application/json',
  123 |         body: JSON.stringify({ html: '<h1>Resume</h1>' }),
  124 |       });
  125 |     });
  126 | 
  127 |     await page.goto('/interview/2');
  128 | 
  129 |     // Check page loaded
  130 |     await expect(page.locator('.content-header h2')).toContainText('Technical Questions');
  131 | 
  132 |     // Click Download Resume
  133 |     await page.click('.primary-button:has-text("Download Resume")');
  134 | 
  135 |     // Verify loading screen for resume
  136 |     const loadingText = page.locator('.loading-text h2');
  137 |     const loadingSubText = page.locator('.loading-text p');
  138 |     await expect(loadingText).toHaveText('Preparing Resume');
  139 |     await expect(loadingSubText).toHaveText('Formatting and compiling your customized resume PDF...');
  140 |   });
  141 | });
  142 | 
```