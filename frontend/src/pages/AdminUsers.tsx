import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { User } from '../services/auth';
import { getAdminUsers, updateAdminUser, deleteAdminUser, createAdminUser, uploadUserAvatar } from '../services/admin';
import Loader from '../components/Loader';
import { useModal } from '../context/ModalContext';
import { API_URL } from '../services/api';

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5MB

interface CreateUserForm {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: string;
  company_name: string;
}

const emptyForm: CreateUserForm = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  role: '',
  company_name: '',
};

interface EditUserForm {
  name: string;
  email: string;
  phone_number: string;
  company_name: string;
  role: string;
  newPassword: string;
  confirmNewPassword: string;
}

export default function AdminUsers() {
  const { t } = useTranslation('admin');
  const modal = useModal();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create user state
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateUserForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit user state
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<EditUserForm>({ name: '', email: '', phone_number: '', company_name: '', role: '', newPassword: '', confirmNewPassword: '' });
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null);
  const [editAvatarPreview, setEditAvatarPreview] = useState<string | null>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  // Cleanup avatar preview URLs
  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);
  useEffect(() => {
    return () => {
      if (editAvatarPreview) URL.revokeObjectURL(editAvatarPreview);
    };
  }, [editAvatarPreview]);

  async function loadUsers() {
    try {
      setUsers(await getAdminUsers());
    } catch {
      setError(t('failedLoadUsers'));
    } finally {
      setLoading(false);
    }
  }

  async function handleRoleChange(user: User, newRole: string) {
    try {
      const updated = await updateAdminUser(user.id, { role: newRole });
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
    } catch {
      await modal.alert({ title: t('error', { ns: 'common' }), message: t('failedUpdateRole') });
    }
  }

  async function handleDelete(id: number) {
    if (!await modal.confirm({ title: t('Delete User'), message: t('deleteUserConfirm'), variant: 'danger' })) return;
    try {
      await deleteAdminUser(id);
      setUsers(prev => prev.filter(u => u.id !== id));
    } catch (err: any) {
      await modal.alert({ title: t('error', { ns: 'common' }), message: err.response?.data?.detail || t('delete', { ns: 'common' }) });
    }
  }

  function openCreateForm() {
    setForm(emptyForm);
    setFormError('');
    setAvatarFile(null);
    setAvatarPreview(null);
    setShowForm(true);
  }

  function handleAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setFormError(t('invalidImageType'));
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      setFormError(t('imageTooLarge'));
      return;
    }

    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setFormError('');
  }

  function removeAvatar() {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(null);
    setAvatarPreview(null);
  }

  function openEditModal(user: User) {
    setEditUser(user);
    setEditForm({
      name: user.name || '',
      email: user.email || '',
      phone_number: user.phone_number || '',
      company_name: user.company_name || '',
      role: user.role,
      newPassword: '',
      confirmNewPassword: '',
    });
    setEditError('');
    setEditAvatarFile(null);
    if (editAvatarPreview) URL.revokeObjectURL(editAvatarPreview);
    setEditAvatarPreview(null);
  }

  function closeEditModal() {
    setEditUser(null);
    setEditError('');
    setEditAvatarFile(null);
    if (editAvatarPreview) URL.revokeObjectURL(editAvatarPreview);
    setEditAvatarPreview(null);
  }

  function handleEditAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setEditError(t('invalidImageType'));
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      setEditError(t('imageTooLarge'));
      return;
    }
    if (editAvatarPreview) URL.revokeObjectURL(editAvatarPreview);
    setEditAvatarFile(file);
    setEditAvatarPreview(URL.createObjectURL(file));
    setEditError('');
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    setEditError('');

    if (!editForm.name.trim()) { setEditError(t('nameRequired')); return; }
    if (!editForm.email.trim()) { setEditError(t('emailRequired')); return; }
    if (!editForm.role) { setEditError(t('roleRequired')); return; }
    if (editForm.newPassword && editForm.newPassword.length < 6) { setEditError(t('passwordMinChars')); return; }
    if (editForm.newPassword && editForm.newPassword !== editForm.confirmNewPassword) { setEditError(t('passwordsNoMatch')); return; }

    setEditSaving(true);
    try {
      const payload: Record<string, string> = {};
      if (editForm.name.trim() !== editUser.name) payload.name = editForm.name.trim();
      if (editForm.email.trim() !== editUser.email) payload.email = editForm.email.trim();
      if (editForm.role !== editUser.role) payload.role = editForm.role;
      if (editForm.phone_number.trim() !== (editUser.phone_number || '')) payload.phone_number = editForm.phone_number.trim();
      if (editForm.company_name.trim() !== (editUser.company_name || '')) payload.company_name = editForm.company_name.trim();
      if (editForm.newPassword) payload.password = editForm.newPassword;

      let updated = editUser;
      if (Object.keys(payload).length > 0) {
        updated = await updateAdminUser(editUser.id, payload);
      }

      // Upload new avatar if selected
      if (editAvatarFile) {
        try {
          updated = await uploadUserAvatar(editUser.id, editAvatarFile);
        } catch {
          // User fields were updated, avatar upload failed
        }
      }

      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
      closeEditModal();
    } catch (err: any) {
      setEditError(err.response?.data?.detail || t('failedUpdateUser'));
    } finally {
      setEditSaving(false);
    }
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');

    // Client-side validation
    if (!form.name.trim()) {
      setFormError(t('nameRequired'));
      return;
    }
    if (!form.email.trim()) {
      setFormError(t('emailRequired'));
      return;
    }
    if (!form.role) {
      setFormError(t('roleRequired'));
      return;
    }
    if (form.password.length < 6) {
      setFormError(t('passwordMinChars'));
      return;
    }
    if (form.password !== form.confirmPassword) {
      setFormError(t('passwordsNoMatch'));
      return;
    }

    setSaving(true);
    try {
      const created = await createAdminUser({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        company_name: form.company_name.trim() || undefined,
      });

      // Upload avatar if selected
      if (avatarFile) {
        try {
          const updated = await uploadUserAvatar(created.id, avatarFile);
          setUsers(prev => [updated, ...prev]);
        } catch {
          // User was created, avatar upload failed — still add user to list
          setUsers(prev => [created, ...prev]);
        }
      } else {
        setUsers(prev => [created, ...prev]);
      }

      setShowForm(false);
      setForm(emptyForm);
      setAvatarFile(null);
      setAvatarPreview(null);
    } catch (err: any) {
      setFormError(err.response?.data?.detail || t('creating'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loader variant="page" />;

  return (
    <div className="admin-page">
      <div className="admin-tabs">
        <Link to="/admin/users" className="admin-tab active">{t('users')}</Link>
        <Link to="/admin/spaces" className="admin-tab">{t('spaces')}</Link>
        <Link to="/admin/orders" className="admin-tab">{t('orders')}</Link>
        <Link to="/admin/calendar" className="admin-tab">{t('calendar')}</Link>
        <Link to="/admin/notifications" className="admin-tab">{t('notifications')}</Link>
        <Link to="/admin/translations" className="admin-tab">{t('translations')}</Link>
        <Link to="/admin/settings" className="admin-tab">{t('settings')}</Link>
      </div>

      <div className="admin-header">
        <h1>{t('manageUsers')}</h1>
        <button onClick={openCreateForm} className="btn-primary"> {t('addUser')}</button>
      </div>
      {error && <div className="error-msg">{error}</div>}

      {showForm && (
        <form onSubmit={handleCreateSubmit} className="admin-form">
          <h2>{t('createUser')}</h2>
          {formError && <div className="error-msg">{formError}</div>}

          <div className="admin-form-section">
            <h3 className="admin-form-section-title">{t('accountInfo')}</h3>
            <div className="form-grid">
              <div>
                <label>{t('username')} *</label>
                <input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  required
                  placeholder={t('fullName')}
                />
              </div>
              <div>
                <label>{t('email')} *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  required
                  placeholder={t('emailPlaceholder')}
                />
              </div>
              <div>
                <label>{t('passwordLabel')} *</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  required
                  minLength={6}
                  placeholder={t('minChars')}
                />
              </div>
              <div>
                <label>{t('confirmPassword')} *</label>
                <input
                  type="password"
                  value={form.confirmPassword}
                  onChange={e => setForm({ ...form, confirmPassword: e.target.value })}
                  required
                  minLength={6}
                  placeholder={t('reenterPassword')}
                />
              </div>
              <div>
                <label>{t('role')} *</label>
                <select
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}
                  required
                  className="admin-select"
                >
                  <option value="">{t('selectRole')}</option>
                  <option value="user">{t('roleUser')}</option>
                  <option value="admin">{t('roleAdmin')}</option>
                  <option value="partner">{t('rolePartner')}</option>
                </select>
              </div>
              <div>
                <label>{t('companyName')}</label>
                <input
                  value={form.company_name}
                  onChange={e => setForm({ ...form, company_name: e.target.value })}
                  placeholder={t('optional')}
                />
              </div>
            </div>
          </div>

          <div className="admin-form-section">
            <h3 className="admin-form-section-title">{t('profilePicture')}</h3>
            <div className="admin-avatar-upload">
              {avatarPreview ? (
                <div className="admin-avatar-preview">
                  <img src={avatarPreview} alt="Preview" />
                  <button type="button" className="admin-avatar-remove" onClick={removeAvatar} title="Remove">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="admin-avatar-placeholder"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  <span>{t('uploadPhoto')}</span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleAvatarSelect}
                style={{ display: 'none' }}
              />
            </div>
            <p className="admin-form-hint">{t('avatarHint')}</p>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? t('creating') : t('createUser')}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary" disabled={saving}>
              {t('cancel', { ns: 'common' })}
            </button>
          </div>
        </form>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('id')}</th>
              <th>{t('avatar')}</th>
              <th>{t('name')}</th>
              <th>{t('email')}</th>
              <th>{t('phone')}</th>
              <th>{t('company')}</th>
              <th>{t('role')}</th>
              <th>{t('created')}</th>
              <th>{t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id}>
                <td>{user.id}</td>
                <td>
                  <div className="admin-table-avatar">
                    {user.profile_picture ? (
                      <img src={`${API_URL}${user.profile_picture}`} alt="" />
                    ) : (
                      <span className="admin-table-avatar-initials">
                        {user.name ? user.name.charAt(0).toUpperCase() : '?'}
                      </span>
                    )}
                  </div>
                </td>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>{user.phone_number || '—'}</td>
                <td>{user.company_name || '—'}</td>
                <td>
                  <div className={`admin-role-pill role-${user.role}`}>
                    <select
                      value={user.role}
                      onChange={e => handleRoleChange(user, e.target.value)}
                      className="admin-role-select"
                    >
                      <option value="user">{t('roleUser')}</option>
                      <option value="admin">{t('roleAdmin')}</option>
                      <option value="partner">{t('rolePartner')}</option>
                    </select>
                  </div>
                </td>
                <td>{new Date(user.created_at).toLocaleDateString()}</td>
                <td>
                  <div className="admin-actions-row">
                    <button onClick={() => openEditModal(user)} className="btn-secondary btn-sm">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button onClick={() => handleDelete(user.id)} className="btn-danger btn-sm">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Edit User Modal ── */}
      {editUser && (
        <div className="admin-edit-overlay" onClick={closeEditModal}>
          <div className="admin-edit-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-edit-modal-header">
              <h2>{t('editUser')}</h2>
              <button type="button" className="admin-edit-modal-close" onClick={closeEditModal}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="admin-edit-modal-body">
              {editError && <div className="error-msg">{editError}</div>}

              {/* Avatar */}
              <div className="admin-edit-avatar-section">
                <div className="admin-edit-avatar">
                  {editAvatarPreview ? (
                    <img src={editAvatarPreview} alt="" />
                  ) : editUser.profile_picture ? (
                    <img src={`${API_URL}${editUser.profile_picture}`} alt="" />
                  ) : (
                    <span className="admin-edit-avatar-initials">{editUser.name?.charAt(0).toUpperCase() || '?'}</span>
                  )}
                </div>
                <div className="admin-edit-avatar-actions">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => editFileInputRef.current?.click()}>
                    {t('changeAvatar')}
                  </button>
                  {(editAvatarPreview || editUser.profile_picture) && (
                    <button type="button" className="btn-danger btn-sm" onClick={() => {
                      if (editAvatarPreview) URL.revokeObjectURL(editAvatarPreview);
                      setEditAvatarFile(null);
                      setEditAvatarPreview(null);
                    }}>
                      {t('removeAvatar')}
                    </button>
                  )}
                </div>
                <input ref={editFileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleEditAvatarSelect} style={{ display: 'none' }} />
              </div>

              {/* Fields */}
              <div className="admin-edit-fields">
                <div className="admin-edit-field">
                  <label>{t('username')}</label>
                  <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} placeholder={t('fullName')} />
                </div>
                <div className="admin-edit-field">
                  <label>{t('email')}</label>
                  <input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} placeholder={t('emailPlaceholder')} />
                </div>
                <div className="admin-edit-field">
                  <label>{t('phone')}</label>
                  <input value={editForm.phone_number} onChange={e => setEditForm({ ...editForm, phone_number: e.target.value })} placeholder={t('phonePlaceholder')} />
                </div>
                <div className="admin-edit-field">
                  <label>{t('companyName')}</label>
                  <input value={editForm.company_name} onChange={e => setEditForm({ ...editForm, company_name: e.target.value })} placeholder={t('optional')} />
                </div>
                <div className="admin-edit-field">
                  <label>{t('role')}</label>
                  <select value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })} className="admin-select">
                    <option value="user">{t('roleUser')}</option>
                    <option value="admin">{t('roleAdmin')}</option>
                    <option value="partner">{t('rolePartner')}</option>
                  </select>
                </div>
              </div>

              {/* Password Reset */}
              <div className="admin-edit-section-divider">
                <span>{t('resetPassword')}</span>
              </div>
              <div className="admin-edit-fields">
                <div className="admin-edit-field">
                  <label>{t('newPassword')}</label>
                  <input type="password" value={editForm.newPassword} onChange={e => setEditForm({ ...editForm, newPassword: e.target.value })} placeholder={t('newPasswordPlaceholder')} autoComplete="new-password" />
                </div>
                {editForm.newPassword && (
                  <div className="admin-edit-field">
                    <label>{t('confirmNewPassword')}</label>
                    <input type="password" value={editForm.confirmNewPassword} onChange={e => setEditForm({ ...editForm, confirmNewPassword: e.target.value })} placeholder={t('reenterPassword')} autoComplete="new-password" />
                  </div>
                )}
              </div>

              <div className="admin-edit-modal-footer">
                <button type="button" className="btn-secondary" onClick={closeEditModal} disabled={editSaving}>{t('cancel', { ns: 'common' })}</button>
                <button type="submit" className="btn-primary" disabled={editSaving}>{editSaving ? t('savingUser') : t('saveUser')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
