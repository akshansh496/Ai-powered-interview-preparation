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

  test('should generate strategy successfully and navigate to plan details', async ({ page }) => {
    // Intercept generate report request
    await page.route('**/api/interview/', async (route, request) => {
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            interviewReport: { _id: '2', title: 'New Plan', matchScore: 90 }
          }),
        });
      } else {
        await route.fallback();
      }
    });

    await page.goto('/');
    
    // Check main elements are visible
    await expect(page.locator('h1')).toContainText('Create Your Custom Interview Plan');
    await expect(page.locator('.recent-reports')).toContainText('Recent Plan');

    // Fill out form
    await page.fill('.panel--left textarea', 'Senior Software Engineer with React');
    await page.fill('.self-description textarea', '5 years of frontend experience');

    // Click generate button and verify navigation
    await page.click('.generate-btn');
    await page.waitForURL('**/interview/2');
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
      } else {
        await route.fallback();
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

  test('should support downloading resume on plan details page', async ({ page }) => {
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

    // Intercept resume download and return dummy HTML
    await page.route('**/api/interview/resume/pdf/2', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ html: '<h1>Resume</h1>' }),
      });
    });

    await page.goto('/interview/2');

    // Check page loaded
    await expect(page.locator('.content-header h2')).toContainText('Technical Questions');

    // Click Download Resume and verify no crash occurred (page remains visible)
    await page.click('.primary-button:has-text("Download Resume")');
    await expect(page.locator('.content-header h2')).toContainText('Technical Questions');
  });

  test('should display validation and credentials error on Login page', async ({ page }) => {
    // Intercept login requests to fail on incorrect credentials
    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Incorrect password' }),
      });
    });

    // Make me() call fail to force login view redirection
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized' }),
      });
    });

    await page.goto('/');
    await page.waitForURL('**/login');

    // Test empty fields check
    await page.click('button:has-text("Login")');
    await expect(page.locator('.auth-error-banner')).toHaveText('Email field is required');

    await page.fill('#email', 'test@example.com');
    await page.click('button:has-text("Login")');
    await expect(page.locator('.auth-error-banner')).toHaveText('Password field is required');

    // Test server response error (wrong password)
    await page.fill('#password', 'wrongpassword');
    await page.click('button:has-text("Login")');
    await expect(page.locator('.auth-error-banner')).toHaveText('Incorrect password');
  });

  test('should require a resume or self-description on generation attempt', async ({ page }) => {
    await page.goto('/');
    
    // Attempt generation with blank fields
    await page.fill('.panel--left textarea', 'Senior Software Engineer');
    await page.click('.generate-btn');

    // Asserts that the glassmorphic custom error boundary catches it
    await expect(page.locator('.error-screen h2')).toHaveText('Something Went Wrong');
    await expect(page.locator('.error-screen p')).toContainText('A resume file or a quick self-description is required to generate a personalized plan.');

    // Click Try Again
    await page.click('.error-actions button');
    await expect(page.locator('h1')).toContainText('Create Your Custom');
  });

  test('should support starring and deleting plans from the dashboard', async ({ page }) => {
    // Intercept star status update API
    let starStatus = false;
    await page.route('**/api/interview/star/1', async (route, request) => {
      if (request.method() === 'PATCH') {
        const body = JSON.parse(request.postData());
        starStatus = body.isStarred;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Star status updated',
            interviewReport: { _id: '1', title: 'Recent Plan', isStarred: starStatus }
          }),
        });
      }
    });

    // Intercept delete report API
    await page.route('**/api/interview/1', async (route, request) => {
      if (request.method() === 'DELETE') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Interview plan deleted successfully.' }),
        });
      }
    });

    await page.goto('/');

    // Verify Star toggles state and updates class
    const starBtn = page.locator('.star-btn');
    await expect(starBtn).not.toHaveClass(/star-btn--active/);

    // Star the plan
    await starBtn.click();
    await expect(starBtn).toHaveClass(/star-btn--active/);
    expect(starStatus).toBe(true);

    // Unstar the plan
    await starBtn.click();
    await expect(starBtn).not.toHaveClass(/star-btn--active/);
    expect(starStatus).toBe(false);

    // Trigger delete confirmation prompt stub
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('Are you sure you want to delete this interview plan?');
      await dialog.accept();
    });

    // Hover over plan list item to make delete button visible, then click
    await page.hover('.report-item');
    await page.click('.delete-btn');

    // Verify card is removed from reports list
    await expect(page.locator('.recent-reports')).toHaveCount(0);
  });
});