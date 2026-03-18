import React from 'react';
import {
  User, Mail, Phone, MapPin, Linkedin, Github, Globe,
  Briefcase, GraduationCap, Zap, Shield, Calendar,
} from 'lucide-react';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { EmptyState } from './ui/EmptyState';
import type { UserProfile } from '../../shared/profile';
import { formatPhone, formatLocation } from '../../shared/profile';

interface ProfileTabProps {
  profile: UserProfile | null;
}

export function ProfileTab({ profile }: ProfileTabProps) {
  if (!profile) {
    return (
      <div className="de-tab-panel active">
        <EmptyState
          icon={<User size={18} />}
          title="No profile found"
          description="Complete onboarding and upload your resume to see your profile here."
        />
      </div>
    );
  }

  const { personal, professional, work, education, skills, summary, workAuth, selfId } = profile;
  const nameParts = [personal.firstName, personal.middleName, personal.lastName].filter(Boolean);
  const fullName = nameParts.join(' ');
  const phone = formatPhone(personal.phone);
  const location = formatLocation(personal.location);

  return (
    <div className="de-tab-panel active">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900, margin: '0 auto' }}>

        {/* Personal info */}
        <Card title={
          <span className="flex-row">
            <User size={13} />
            Personal Information
          </span>
        }>
          <div className="dl-grid">
            {personal.firstName && <DlCell label="First Name" value={personal.firstName} />}
            {personal.middleName && <DlCell label="Middle Name" value={personal.middleName} />}
            {personal.lastName && <DlCell label="Last Name" value={personal.lastName} />}
            {personal.preferredName && <DlCell label="Preferred Name" value={personal.preferredName} />}
            {personal.email && (
              <DlCell label="Email" value={<a href={`mailto:${personal.email}`}>{personal.email}</a>} />
            )}
            {phone && <DlCell label="Phone" value={phone} />}
            {location && <DlCell label="Location" value={location} />}
          </div>
        </Card>

        {/* Professional links */}
        {(professional?.linkedin || professional?.github || professional?.portfolio ||
          professional?.yearsOfExperience !== undefined) && (
          <Card title={
            <span className="flex-row">
              <Globe size={13} />
              Professional
            </span>
          }>
            <div className="dl-grid">
              {professional.yearsOfExperience !== undefined && (
                <DlCell label="Experience" value={`${professional.yearsOfExperience}y`} />
              )}
              {professional.salaryExpectation && (
                <DlCell label="Salary" value={professional.salaryExpectation} />
              )}
              {professional.noticePeriod && (
                <DlCell label="Notice Period" value={professional.noticePeriod} />
              )}
              {professional.linkedin && (
                <DlCell label="LinkedIn" value={
                  <a href={professional.linkedin} target="_blank" rel="noopener noreferrer">
                    {professional.linkedin.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//i, '')}
                  </a>
                } />
              )}
              {professional.github && (
                <DlCell label="GitHub" value={
                  <a href={professional.github} target="_blank" rel="noopener noreferrer">
                    {professional.github.replace(/^https?:\/\/(www\.)?github\.com\//i, '')}
                  </a>
                } />
              )}
              {professional.portfolio && (
                <DlCell label="Portfolio" value={
                  <a href={professional.portfolio} target="_blank" rel="noopener noreferrer">
                    {professional.portfolio.replace(/^https?:\/\//i, '')}
                  </a>
                } />
              )}
            </div>
          </Card>
        )}

        {/* Summary */}
        {summary && (
          <Card title="Summary">
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {summary}
            </p>
          </Card>
        )}

        {/* Work history */}
        <Card title={
          <span className="flex-row">
            <Briefcase size={13} />
            Work Experience
          </span>
        } action={
          work?.length ? (
            <span className="badge badge-neutral">{work.length}</span>
          ) : undefined
        }>
          {(!work || work.length === 0) ? (
            <EmptyState title="No work history" description="Add work experience to your profile." />
          ) : (
            <div className="timeline" style={{ paddingTop: 8 }}>
              {work.map((job, i) => (
                <div key={i} className="timeline-item">
                  <div className={`timeline-dot ${job.current ? 'current' : ''}`} />
                  <div className="timeline-company">{job.company}</div>
                  <div className="timeline-title">{job.title}</div>
                  <div className="timeline-dates">
                    {job.startDate || '?'} — {job.current ? 'Present' : (job.endDate || '?')}
                  </div>
                  {job.description && (
                    <div style={{
                      marginTop: 6,
                      fontSize: 12,
                      color: 'var(--text-faint)',
                      lineHeight: 1.6,
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>
                      {job.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Education */}
        {education?.length > 0 && (
          <Card title={
            <span className="flex-row">
              <GraduationCap size={13} />
              Education
            </span>
          }>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
              {education.map((edu, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{edu.school}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {[edu.degree, edu.field].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {edu.graduationYear && (
                    <span className="badge badge-neutral">{edu.graduationYear}</span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Skills */}
        {skills?.length > 0 && (
          <Card title={
            <span className="flex-row">
              <Zap size={13} />
              Skills
            </span>
          } action={
            <span className="badge badge-neutral">{skills.length}</span>
          }>
            <div className="chips-wrap">
              {skills.map((s, i) => (
                <span key={i} className="chip">{s}</span>
              ))}
            </div>
          </Card>
        )}

        {/* Work Authorization */}
        {workAuth && (
          <Card title={
            <span className="flex-row">
              <Shield size={13} />
              Work Authorization
            </span>
          }>
            <div className="dl-grid">
              <DlCell label="Requires Sponsorship" value={
                <Badge variant={workAuth.requiresSponsorship ? 'warning' : 'success'}>
                  {workAuth.requiresSponsorship ? 'Yes' : 'No'}
                </Badge>
              } />
              <DlCell label="Legally Authorized" value={
                <Badge variant={workAuth.legallyAuthorized ? 'success' : 'danger'}>
                  {workAuth.legallyAuthorized ? 'Yes' : 'No'}
                </Badge>
              } />
              {workAuth.visaType && <DlCell label="Visa Type" value={workAuth.visaType} />}
              {workAuth.currentStatus && <DlCell label="Status" value={workAuth.currentStatus} />}
              {workAuth.sponsorshipTimeline && <DlCell label="Timeline" value={workAuth.sponsorshipTimeline} />}
            </div>
          </Card>
        )}

        {/* Self ID */}
        {selfId && (
          <Card title="Self Identification">
            <div className="dl-grid">
              {selfId.gender?.length > 0 && (
                <DlCell label="Gender" value={selfId.gender.join(', ')} />
              )}
              {selfId.race?.length > 0 && (
                <DlCell label="Race" value={selfId.race.join(', ')} />
              )}
              {selfId.veteran && (
                <DlCell label="Veteran Status" value={selfId.veteran} />
              )}
              {selfId.disability && (
                <DlCell label="Disability" value={selfId.disability} />
              )}
              {selfId.ethnicity && (
                <DlCell label="Ethnicity" value={selfId.ethnicity} />
              )}
            </div>
          </Card>
        )}

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

function DlCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="dl-cell">
      <div className="dl-label">{label}</div>
      <div className="dl-value">{value}</div>
    </div>
  );
}
