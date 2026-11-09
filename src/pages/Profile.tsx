import { useState } from "react";
import { Link } from "react-router-dom";
import { PhotoActions } from "../components/photo-editor";
import { Avatar, Banner, Button, PageHeader, PasswordInput } from "../components/ui";
import { photoSrc } from "../lib/photo";
import { fullName } from "../lib/format";
import { useApp } from "../store/store";

export function Profile() {
  const { state, user, actions } = useApp();
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [personalEmail, setEmail] = useState(user?.personalEmail ?? "");
  const [address, setAddress] = useState(user?.address ?? "");
  const [emergencyName, setEmergency] = useState(user?.emergencyName ?? "");
  const [emergencyRelationship, setRelationship] = useState(user?.emergencyRelationship ?? "");
  const [emergencyPhone, setEmergencyPhone] = useState(user?.emergencyPhone ?? "");
  const [emergencySecondaryName, setSecondary] = useState(user?.emergencySecondaryName ?? "");
  const [emergencySecondaryRelationship, setSecondaryRelationship] = useState(user?.emergencySecondaryRelationship ?? "");
  const [emergencySecondaryPhone, setSecondaryPhone] = useState(user?.emergencySecondaryPhone ?? "");
  const [showBirthday, setShow] = useState(user?.showBirthday ?? true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  if (!user) return null;
  if (!state.employees.some((item) => item.id === user.id)) {
    return (
      <div className="narrow">
        <PageHeader title="My profile" subtitle={user.email} />
        <Banner>This login is not linked to an employee record. Personal details stay on the employee profile, and this page does not create one.</Banner>
        <PasswordForm />
      </div>
    );
  }
  return (
    <div className="narrow">
      <PageHeader title="My profile" subtitle="Update how colleagues can reach you, and whether your birthday appears in the company feed." actions={<Link className="btn btn-secondary" to={`/people/${user.id}`}>Open full profile</Link>} />
      <form className="panel" noValidate onSubmit={async (event) => {
        event.preventDefault();
        const result = await actions.updateProfile({ phone, personalEmail, address, emergencyName, emergencyRelationship, emergencyPhone, emergencySecondaryName, emergencySecondaryRelationship, emergencySecondaryPhone, showBirthday });
        setSaved(result.ok);
        setError(result.ok ? "" : result.message);
      }}>
        {error && <Banner tone="error">{error}</Banner>}
        {saved && <Banner tone="success">Profile saved.</Banner>}
        <div className="profile-hero">
          <Avatar name={fullName(user)} color={user.avatarColor} size={72} photoSrc={photoSrc(user.id, user.photoUpdatedAt)} labelled />
          <div>
            <p className="muted">{user.jobTitle} · {user.email}. Job details are changed by HR.</p>
            <PhotoActions
              name={fullName(user)}
              hasPhoto={Boolean(user.photoUpdatedAt)}
              canEdit
              savePhoto={(file) => actions.savePhoto(user.id, file)}
              removePhoto={() => actions.removePhoto(user.id)}
            />
          </div>
        </div>
        <label className="field">Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
        <label className="field">Personal email<input value={personalEmail} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="field">Address<input value={address} onChange={(event) => setAddress(event.target.value)} /></label>
        <label className="field">Emergency contact<input value={emergencyName} onChange={(event) => setEmergency(event.target.value)} /></label>
        <label className="field">Relationship<input value={emergencyRelationship} onChange={(event) => setRelationship(event.target.value)} /></label>
        <label className="field">Emergency phone<input value={emergencyPhone} onChange={(event) => setEmergencyPhone(event.target.value)} /></label>
        <label className="field">Secondary contact<input value={emergencySecondaryName} onChange={(event) => setSecondary(event.target.value)} /></label>
        <label className="field">Secondary relationship<input value={emergencySecondaryRelationship} onChange={(event) => setSecondaryRelationship(event.target.value)} /></label>
        <label className="field">Secondary phone<input value={emergencySecondaryPhone} onChange={(event) => setSecondaryPhone(event.target.value)} /></label>
        <label className="check">
          <input type="checkbox" checked={showBirthday} onChange={(event) => setShow(event.target.checked)} />
          <span>Show my birthday to colleagues. HR can still see it.</span>
        </label>
        <Button type="submit">Save profile</Button>
      </form>
      <PasswordForm />
    </div>
  );
}

function PasswordForm() {
  const { actions } = useApp();
  const [currentPassword, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <form className="panel" noValidate onSubmit={async (event) => {
      event.preventDefault();
      setSaved(false);
      if (password !== confirm) {
        setError("Those passwords do not match.");
        return;
      }
      const result = await actions.changePassword(currentPassword, password, confirm);
      setSaved(result.ok);
      setError(result.ok ? "" : result.message);
      if (result.ok) {
        setCurrent("");
        setPassword("");
        setConfirm("");
      }
    }}>
      <h2>Password</h2>
      {error && <Banner tone="error">{error}</Banner>}
      {saved && <Banner tone="success">Password updated.</Banner>}
      <label className="field">Current password<PasswordInput autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrent(event.target.value)} /></label>
      <label className="field">New password<PasswordInput autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label className="field">Confirm new password<PasswordInput autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
      <Button type="submit">Update password</Button>
    </form>
  );
}
