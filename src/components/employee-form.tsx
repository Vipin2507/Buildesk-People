import { useState } from "react";
import type { EmployeeDraft } from "../store/mutations";
import { useApp } from "../store/store";
import type { Employee, EmploymentStatus, EmploymentType, Role } from "../types";
import { Banner, Button, Field } from "./ui";

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
  const [draft, setDraft] = useState<EmployeeDraft>(employee ? toDraft(employee) : { ...EMPTY, departmentId: state.departments[0]?.id ?? "", locationId: state.locations[0]?.id ?? "" });
  const [error, setError] = useState("");
  const set = (patch: Partial<EmployeeDraft>) => setDraft((current) => ({ ...current, ...patch }));
  return (
    <form
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await actions.saveEmployee(draft);
        if (!result.ok) setError(result.message);
        else onDone();
      }}
    >
      {error && <Banner tone="error">{error}</Banner>}
      <div className="form-grid">
        <Field label="First name"><input value={draft.firstName} onChange={(event) => set({ firstName: event.target.value })} /></Field>
        <Field label="Last name"><input value={draft.lastName} onChange={(event) => set({ lastName: event.target.value })} /></Field>
        <Field label="Work email"><input type="email" value={draft.email} onChange={(event) => set({ email: event.target.value })} /></Field>
        <Field label="Job title"><input value={draft.jobTitle} onChange={(event) => set({ jobTitle: event.target.value })} /></Field>
        <Field label="Department">
          <select value={draft.departmentId} onChange={(event) => set({ departmentId: event.target.value })}>
            {state.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
        <Field label="Location">
          <select value={draft.locationId} onChange={(event) => set({ locationId: event.target.value })}>
            {state.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
        <Field label="Manager">
          <select value={draft.managerId ?? ""} onChange={(event) => set({ managerId: event.target.value || null })}>
            <option value="">No manager</option>
            {state.employees.filter((item) => item.id !== employee?.id && item.status !== "inactive").map((item) => (
              <option key={item.id} value={item.id}>{item.firstName} {item.lastName}</option>
            ))}
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
        <Field label="Joining date"><input type="date" value={draft.joiningDate} onChange={(event) => set({ joiningDate: event.target.value })} /></Field>
        <Field label="Date of birth" hint="Can be hidden from the company birthday feed."><input type="date" value={draft.dateOfBirth} onChange={(event) => set({ dateOfBirth: event.target.value })} /></Field>
        <Field label="Phone"><input value={draft.phone} onChange={(event) => set({ phone: event.target.value })} /></Field>
        <Field label="Personal email"><input value={draft.personalEmail} onChange={(event) => set({ personalEmail: event.target.value })} /></Field>
        <Field label="Address"><input value={draft.address} onChange={(event) => set({ address: event.target.value })} /></Field>
        <Field label="Emergency contact"><input value={draft.emergencyName} onChange={(event) => set({ emergencyName: event.target.value })} /></Field>
        <Field label="Emergency phone"><input value={draft.emergencyPhone} onChange={(event) => set({ emergencyPhone: event.target.value })} /></Field>
        {can("settings.roles") && (
          <Field label="Directory role" hint="This label is on the employee record. Login access is a separate account in User Management.">
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
      <label className="check">
        <input type="checkbox" checked={draft.showBirthday} onChange={(event) => set({ showBirthday: event.target.checked })} />
        <span>Show birthday on the company feed</span>
      </label>
      <div className="actions">
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit">{employee ? "Save employee" : "Add employee"}</Button>
      </div>
    </form>
  );
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
