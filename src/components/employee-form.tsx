import { useEffect, useRef, useState } from "react";
import { todayIso } from "../domain/dates";
import { fullName } from "../lib/format";
import type { EmployeeDraft } from "../store/mutations";
import { useApp } from "../store/store";
import type { Employee, EmploymentStatus, EmploymentType, Role } from "../types";
import { Banner, Button, DatePicker, Field } from "./ui";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EMPTY: EmployeeDraft = {
  firstName: "",
  lastName: "",
  email: "",
  jobTitle: "",
  departmentId: "",
  managerId: null,
  locationId: "",
  employmentType: "full_time",
  status: "active",
  joiningDate: "",
  phone: "",
  personalEmail: "",
  address: "",
  emergencyName: "",
  emergencyPhone: "",
  dateOfBirth: "",
  showBirthday: true,
  role: "employee",
};

export function EmployeeForm({ employee, onDone }: { employee?: Employee; onDone: () => void }) {
  const { state, actions, can } = useApp();
  const form = useRef<HTMLFormElement>(null);
  const focusField = useRef("");
  const [focusToken, setFocusToken] = useState(0);
  const [draft, setDraft] = useState<EmployeeDraft>(() => employee ? toDraft(employee) : { ...EMPTY, joiningDate: todayIso() });
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);
  const errors = showErrors ? problems(draft) : {};
  const set = (patch: Partial<EmployeeDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const managers = state.employees
    .filter((item) => item.id !== employee?.id && item.status !== "inactive")
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const departments = [...state.departments].sort((a, b) => a.name.localeCompare(b.name));
  const locations = [...state.locations].sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => {
    if (!focusField.current) return;
    const node = form.current?.querySelector<HTMLElement>(`[data-field="${focusField.current}"]`);
    focusField.current = "";
    node?.focus();
    node?.scrollIntoView({ block: "nearest" });
  }, [focusToken]);

  return (
    <form
      ref={form}
      className="employee-form"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        const found = problems(draft);
        const first = Object.keys(found)[0];
        if (first) {
          focusField.current = first;
          setShowErrors(true);
          setServerError("");
          setFocusToken((value) => value + 1);
          return;
        }
        setBusy(true);
        const result = await actions.saveEmployee(draft);
        setBusy(false);
        if (!result.ok) {
          setServerError(result.message);
          return;
        }
        onDone();
      }}
    >
      <p className="form-note">
        {employee
          ? "Update the work record. Salary stays on the Salary details section."
          : "Work details and date of birth are required. Phone, address, and emergency contact can be left blank."}
        {can("users.manage") ? " If this work email has no login yet, one is created. No email is sent. The first sign-in is where they choose a password." : ""}
      </p>
      {serverError && <Banner tone="error">{serverError}</Banner>}
      <fieldset className="form-section">
        <legend>Work record</legend>
        <div className="form-grid">
          <Field label="First name" required error={errors.firstName}>
            <input data-field="firstName" autoComplete="given-name" aria-required="true" aria-invalid={Boolean(errors.firstName)} value={draft.firstName} onChange={(event) => set({ firstName: event.target.value })} />
          </Field>
          <Field label="Last name" required error={errors.lastName}>
            <input data-field="lastName" autoComplete="family-name" aria-required="true" aria-invalid={Boolean(errors.lastName)} value={draft.lastName} onChange={(event) => set({ lastName: event.target.value })} />
          </Field>
          <Field label="Work email" required error={errors.email}>
            <input data-field="email" type="email" autoComplete="email" aria-required="true" aria-invalid={Boolean(errors.email)} value={draft.email} onChange={(event) => set({ email: event.target.value })} />
          </Field>
          <Field label="Job title" required error={errors.jobTitle}>
            <input data-field="jobTitle" autoComplete="organization-title" aria-required="true" aria-invalid={Boolean(errors.jobTitle)} value={draft.jobTitle} onChange={(event) => set({ jobTitle: event.target.value })} />
          </Field>
          <Field label="Department" required error={errors.departmentId}>
            <select data-field="departmentId" aria-required="true" aria-invalid={Boolean(errors.departmentId)} value={draft.departmentId} onChange={(event) => set({ departmentId: event.target.value })}>
              <option value="">Choose a department</option>
              {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label="Location" required error={errors.locationId}>
            <select data-field="locationId" aria-required="true" aria-invalid={Boolean(errors.locationId)} value={draft.locationId} onChange={(event) => set({ locationId: event.target.value })}>
              <option value="">Choose a location</option>
              {locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label="Manager">
            <select value={draft.managerId ?? ""} onChange={(event) => set({ managerId: event.target.value || null })}>
              <option value="">No manager</option>
              {managers.map((item) => <option key={item.id} value={item.id}>{fullName(item)}</option>)}
            </select>
          </Field>
          <Field label="Employment type">
            <select value={draft.employmentType} onChange={(event) => set({ employmentType: event.target.value as EmploymentType })}>
              <option value="full_time">Full-time</option>
              <option value="contract">Contract</option>
            </select>
          </Field>
          <Field label="Status">
            <select value={draft.status} onChange={(event) => set({ status: event.target.value as EmploymentStatus })}>
              <option value="active">Active</option>
              <option value="on_notice">On notice</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
          <Field label="Joining date" required error={errors.joiningDate}>
            <DatePicker data-field="joiningDate" required aria-required aria-invalid={Boolean(errors.joiningDate)} value={draft.joiningDate} onChange={(joiningDate) => set({ joiningDate })} />
          </Field>
          {can("settings.roles") && (
            <Field className="span-2" label="Directory role" hint="This label is on the employee record. Login access is a separate account in User Management.">
              <select value={draft.role} onChange={(event) => set({ role: event.target.value as Role })}>
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                <option value="hr">HR admin</option>
                <option value="payroll">Payroll admin</option>
                <option value="admin">System admin</option>
              </select>
            </Field>
          )}
        </div>
      </fieldset>
      <fieldset className="form-section">
        <legend>Personal details</legend>
        <div className="form-grid">
          <Field label="Date of birth" required error={errors.dateOfBirth} hint="It can stay off the company birthday feed.">
            <DatePicker data-field="dateOfBirth" required aria-required aria-invalid={Boolean(errors.dateOfBirth)} value={draft.dateOfBirth} onChange={(dateOfBirth) => set({ dateOfBirth })} max={todayIso()} />
          </Field>
          <Field label="Phone">
            <input type="tel" autoComplete="tel" inputMode="tel" value={draft.phone} onChange={(event) => set({ phone: event.target.value })} />
          </Field>
          <Field className="span-2" label="Personal email" error={errors.personalEmail}>
            <input data-field="personalEmail" type="email" autoComplete="off" aria-invalid={Boolean(errors.personalEmail)} value={draft.personalEmail} onChange={(event) => set({ personalEmail: event.target.value })} />
          </Field>
          <Field className="span-2" label="Address">
            <input autoComplete="street-address" value={draft.address} onChange={(event) => set({ address: event.target.value })} />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={draft.showBirthday} onChange={(event) => set({ showBirthday: event.target.checked })} />
          <span>Show birthday on the company feed</span>
        </label>
      </fieldset>
      <fieldset className="form-section">
        <legend>Emergency contact</legend>
        <p className="form-note">Optional. The employee can update this later from My profile.</p>
        <div className="form-grid">
          <Field label="Contact name">
            <input autoComplete="off" value={draft.emergencyName} onChange={(event) => set({ emergencyName: event.target.value })} />
          </Field>
          <Field label="Contact phone">
            <input type="tel" autoComplete="off" inputMode="tel" value={draft.emergencyPhone} onChange={(event) => set({ emergencyPhone: event.target.value })} />
          </Field>
        </div>
      </fieldset>
      <div className="form-actions">
        <Button variant="secondary" onClick={onDone} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : employee ? "Save changes" : "Add employee"}</Button>
      </div>
    </form>
  );
}

function problems(draft: EmployeeDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (draft.firstName.trim().length < 2) errors.firstName = "Enter a first name of at least 2 characters.";
  if (!draft.lastName.trim()) errors.lastName = "Enter a last name.";
  if (!EMAIL.test(draft.email.trim())) errors.email = "Enter a valid work email.";
  if (!draft.jobTitle.trim()) errors.jobTitle = "Enter a job title.";
  if (!draft.departmentId) errors.departmentId = "Choose a department.";
  if (!draft.locationId) errors.locationId = "Choose a location.";
  if (!draft.joiningDate) errors.joiningDate = "Enter a joining date.";
  if (!draft.dateOfBirth || draft.dateOfBirth > todayIso()) errors.dateOfBirth = "Enter a date of birth that is not in the future.";
  if (draft.personalEmail.trim() && !EMAIL.test(draft.personalEmail.trim())) errors.personalEmail = "Enter a valid personal email, or leave it blank.";
  return errors;
}

function toDraft(employee: Employee): EmployeeDraft {
  return {
    id: employee.id,
    firstName: employee.firstName,
    lastName: employee.lastName,
    email: employee.email,
    jobTitle: employee.jobTitle,
    departmentId: employee.departmentId,
    managerId: employee.managerId,
    locationId: employee.locationId,
    employmentType: employee.employmentType,
    status: employee.status,
    joiningDate: employee.joiningDate,
    phone: employee.phone,
    personalEmail: employee.personalEmail,
    address: employee.address,
    emergencyName: employee.emergencyName,
    emergencyPhone: employee.emergencyPhone,
    dateOfBirth: employee.dateOfBirth,
    showBirthday: employee.showBirthday,
    role: employee.role,
    monthlyGross: employee.monthlyGross,
  };
}
