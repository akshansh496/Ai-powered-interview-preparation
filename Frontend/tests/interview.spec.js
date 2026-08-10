import { test, expect } from '@playwright/test';

test.describe('Interview Preparation App E2E Tests', () => {

  test.beforeEach(async ({ page }) => {
    // Intercept auth session check
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { username: 'testuser', email: 'test@example.com' } }),
      });
    });

    // Intercept fetch dashboard reports
    await page.route('**/api/interview/', async (route, request) => {
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            interviewReports: [
              { _id: '1', title: 'Recent Plan', matchScore: 85, createdAt: new Date().toISOString() }
            ]
          }),
        });
      } else {
        await route.fallback();
      }
    });
  });

  test('should display dynamic loading messages when generating strategy and handle success', async ({ page }) => {
    // Intercept generate report request
    await page.route('**/api/interview/', async (route, request) => {
      if (request.method() === 'POST') {
        // Delay response to capture loading state
        await new Promise(resolve => setTimeout(resolve, 500));
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            interviewReport: { _id: '2', title: 'New Plan', matchScore: 90 }
          }),
        });
      }
    });

    await page.goto('/');
    
    // Check main elements are visible
    await expect(page.locator('h1')).toContainText('Create Your Custom Interview Plan');
    await expect(page.locator('.recent-reports')).toContainText('Recent Plan');

    // Fill out form
    await page.fill('.panel--left textarea', 'Senior Software Engineer with React');
    await page.fill('.self-description textarea', '5 years of frontend experience');

    // Click generate button
    await page.click('.generate-btn');

    // Check custom loader text is showing
    const loadingText = page.locator('.loading-text h2');
    const loadingSubText = page.locator('.loading-text p');
    await expect(loadingText).toHaveText('Generating Strategy');
    await expect(loadingSubText).toHaveText('Analyzing job description and preparing your custom questions...');
  });

  test('should display error screen if strategy generation fails', async ({ page }) => {
    // Intercept generate report request to throw error
    await page.route('**/api/interview/', async (route, request) => {
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Server failed to process job description.'
          }),
        });
      }
    });

    await page.goto('/');
    await page.fill('.panel--left textarea', 'fail');
    await page.fill('.self-description textarea', 'fail');
    await page.click('.generate-btn');

    // Check custom error screen
    await expect(page.locator('.error-screen h2')).toHaveText('Something Went Wrong');
    await expect(page.locator('.error-screen p')).toContainText('Server failed to process job description.');

    // Click Try Again to go back to inputs
    await page.click('.error-actions button');
    await expect(page.locator('h1')).toContainText('Create Your Custom');
  });

  test('should display dynamic loading message when downloading resume', async ({ page }) => {
    // Intercept report details
    await page.route('**/api/interview/report/2', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          interviewReport: {
            _id: '2',
            title: 'New Plan',
            matchScore: 90,
            technicalQuestions: [{ question: 'Q1?', intention: 'I1', answer: 'A1' }],
            behavioralQuestions: [{ question: 'BQ1?', intention: 'I1', answer: 'A1' }],
            preparationPlan: [{ day: 1, focus: 'F1', tasks: ['T1'] }],
            skillGaps: [{ skill: 'S1', severity: 'high' }]
          }
        }),
      });
    });

    // Intercept resume download to delay and return dummy HTML
    await page.route('**/api/interview/resume/pdf/2', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ html: '<h1>Resume</h1>' }),
      });
    });

    await page.goto('/interview/2');

    // Check page loaded
    await expect(page.locator('.content-header h2')).toContainText('Technical Questions');

    // Click Download Resume
    await page.click('.primary-button:has-text("Download Resume")');

    // Verify loading screen for resume
    const loadingText = page.locator('.loading-text h2');
    const loadingSubText = page.locator('.loading-text p');
    await expect(loadingText).toHaveText('Preparing Resume');
    await expect(loadingSubText).toHaveText('Formatting and compiling your customized resume PDF...');
  });
});