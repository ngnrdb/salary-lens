import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../extension/content/format.js';
import '../extension/content/extract.js';

const F = globalThis.SL.format;
const X = globalThis.SL.extract;

test('INR badge in LPA', () => {
  assert.equal(F.badge(1800000, 2600000, 'INR', 'year'), '~₹18–26 LPA');
  assert.equal(F.badge(450000, 650000, 'INR', 'year'), '~₹4.5–6.5 LPA');
  assert.equal(F.badge(1200000, 1200000, 'INR', 'year'), '~₹12 LPA');
});

test('INR badge monthly and crore', () => {
  assert.equal(F.badge(1800000, 2640000, 'INR', 'month'), '~₹1.5L–2.2L/mo');
  assert.equal(F.badge(9000000, 12500000, 'INR', 'year'), '~₹90L–1.3Cr /yr');
});

test('USD badge and range', () => {
  assert.equal(F.badge(120000, 150000, 'USD', 'year'), '~$120K–150K/yr');
  assert.equal(F.range(1800000, 2600000, 'INR', 'year'), '₹18L – ₹26L');
  assert.equal(F.money(2150000, 'INR', 'year'), '₹21.5L');
  assert.equal(F.range(1750000, 2600000, 'INR', 'year'), '₹17.5L – ₹26L');
});

test('listed JSON-LD salary converts monthly to yearly', () => {
  assert.equal(F.listed({ min: 100000, max: 150000, currency: 'INR', period: 'month' }, 'year'), '₹12L – ₹18L/yr');
  assert.equal(F.listed({ text: '₹ 12-15 Lacs P.A.' }, 'year'), '₹ 12-15 Lacs P.A.');
});

test('finds listed salary text', () => {
  assert.equal(X.findSalaryText('Full-time · ₹12,00,000/yr - ₹15,00,000/yr · Hybrid'), '₹12,00,000/yr - ₹15,00,000/yr');
  assert.equal(X.findSalaryText('$120K/yr - $150K/yr Remote'), '$120K/yr - $150K/yr');
  assert.equal(X.findSalaryText('₹ 12-15 Lacs P.A.'), '₹ 12-15 Lacs P.A.');
  assert.equal(X.findSalaryText('We raised $5 in funding'), null);
  assert.equal(X.findSalaryText('No salary here'), null);
  assert.equal(X.isUndisclosed('Not Disclosed'), true);
});

test('parses schema.org JobPosting JSON-LD', () => {
  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'Jobs' },
      {
        '@type': 'JobPosting',
        title: 'Senior Data Analyst',
        hiringOrganization: { '@type': 'Organization', name: 'Northwind &amp; Co' },
        jobLocation: { '@type': 'Place', address: { addressLocality: 'Bengaluru', addressRegion: 'Karnataka', addressCountry: 'IN' } },
        experienceRequirements: { monthsOfExperience: 48 },
        baseSalary: { '@type': 'MonetaryAmount', currency: 'INR', value: { '@type': 'QuantitativeValue', minValue: 1800000, maxValue: 2600000, unitText: 'YEAR' } },
      },
    ],
  });
  const job = X.parseJsonLdTexts(['not json', ld]);
  assert.equal(job.title, 'Senior Data Analyst');
  assert.equal(job.company, 'Northwind & Co');
  assert.equal(job.location, 'Bengaluru, IN');
  assert.equal(job.experience, '4+ yrs');
  assert.deepEqual(job.listed, { min: 1800000, max: 2600000, currency: 'INR', period: 'year' });
});

test('remote JSON-LD job and no salary', () => {
  const job = X.parseJsonLdTexts([JSON.stringify([{ '@type': 'JobPosting', title: 'Backend Engineer', hiringOrganization: 'Acme', jobLocationType: 'TELECOMMUTE' }])]);
  assert.equal(job.location, 'Remote');
  assert.equal(job.company, 'Acme');
  assert.equal(job.listed, null);
});

test('site detection', () => {
  assert.equal(X.siteOf('www.linkedin.com'), 'linkedin');
  assert.equal(X.siteOf('in.indeed.com'), 'indeed');
  assert.equal(X.siteOf('www.naukri.com'), 'naukri');
  assert.equal(X.siteOf('example.com'), 'other');
});
