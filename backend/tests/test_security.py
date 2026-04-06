"""
Security tests covering:
  1. Access control — unauthorized access blocked, correct redirects
  2. Password policy — minimum 8 chars, 1 uppercase, 1 lowercase, 1 special char
  3. Cookie-based auth — httpOnly cookie set/used/cleared
  4. Token tampering — forged/modified tokens rejected
"""

from app.utils.security import create_access_token


# ═══════════════════════════════════════════════════════════
#  1. ACCESS CONTROL
# ═══════════════════════════════════════════════════════════

class TestAccessControlAdmin:
    """Admin routes must reject non-admin users."""

    def test_admin_route_no_auth(self, client):
        """Unauthenticated user → 401."""
        response = client.get("/admin/users")
        assert response.status_code == 401

    def test_admin_route_regular_user(self, client, auth_headers):
        """Regular user → 403."""
        response = client.get("/admin/users", headers=auth_headers)
        assert response.status_code == 403
        assert "Admin access required" in response.json()["detail"]

    def test_admin_route_partner_user(self, client, partner_headers):
        """Partner user → 403."""
        response = client.get("/admin/users", headers=partner_headers)
        assert response.status_code == 403

    def test_admin_route_admin_user(self, client, admin_headers):
        """Admin user → 200."""
        response = client.get("/admin/users", headers=admin_headers)
        assert response.status_code == 200

    def test_admin_orders_no_auth(self, client):
        response = client.get("/admin/orders")
        assert response.status_code == 401

    def test_admin_orders_regular_user(self, client, auth_headers):
        response = client.get("/admin/orders", headers=auth_headers)
        assert response.status_code == 403


class TestAccessControlPartner:
    """Partner routes must reject non-partner users."""

    def test_partner_route_no_auth(self, client):
        response = client.get("/partner/dashboard")
        assert response.status_code == 401

    def test_partner_route_regular_user(self, client, auth_headers):
        response = client.get("/partner/dashboard", headers=auth_headers)
        assert response.status_code == 403

    def test_partner_route_admin_user(self, client, admin_headers):
        response = client.get("/partner/dashboard", headers=admin_headers)
        assert response.status_code == 403


class TestAccessControlProtected:
    """Protected routes must reject unauthenticated requests."""

    def test_me_no_auth(self, client):
        response = client.get("/auth/me")
        assert response.status_code == 401

    def test_update_profile_no_auth(self, client):
        response = client.put("/auth/me", json={"name": "Hacker"})
        assert response.status_code == 401

    def test_change_password_no_auth(self, client):
        response = client.put("/auth/me/password", json={
            "current_password": "x", "new_password": "y",
        })
        assert response.status_code == 401

    def test_orders_no_auth(self, client):
        response = client.get("/orders/my")
        assert response.status_code == 401


# ═══════════════════════════════════════════════════════════
#  2. PASSWORD POLICY
# ═══════════════════════════════════════════════════════════

class TestPasswordPolicyRegister:
    """Registration must enforce password policy."""

    def test_register_too_short(self, client):
        response = client.post("/auth/register", json={
            "email": "short@example.com",
            "password": "Ab1",
            "name": "Short Pwd",
        })
        assert response.status_code == 400
        assert "at least 8 characters" in response.json()["detail"]

    def test_register_no_uppercase(self, client):
        response = client.post("/auth/register", json={
            "email": "noupper@example.com",
            "password": "password1",
            "name": "No Upper",
        })
        assert response.status_code == 400
        assert "uppercase" in response.json()["detail"]

    def test_register_no_lowercase(self, client):
        response = client.post("/auth/register", json={
            "email": "nolow@example.com",
            "password": "PASSWORD!",
            "name": "No Lower",
        })
        assert response.status_code == 400
        assert "lowercase" in response.json()["detail"]

    def test_register_no_special(self, client):
        response = client.post("/auth/register", json={
            "email": "nospec@example.com",
            "password": "Password1",
            "name": "No Special",
        })
        assert response.status_code == 400
        assert "special character" in response.json()["detail"]

    def test_register_valid_password(self, client):
        response = client.post("/auth/register", json={
            "email": "valid@example.com",
            "password": "ValidPass1!",
            "name": "Valid User",
        })
        assert response.status_code == 200
        assert "access_token" in response.json()


class TestPasswordPolicyAdminCreate:
    """Admin user creation must enforce password policy."""

    def test_admin_create_user_short_password(self, client, admin_headers):
        response = client.post("/admin/users", json={
            "email": "weak@example.com",
            "password": "Ab1",
            "name": "Weak Pwd",
            "role": "user",
        }, headers=admin_headers)
        assert response.status_code == 400
        assert "at least 8 characters" in response.json()["detail"]

    def test_admin_create_user_no_uppercase(self, client, admin_headers):
        response = client.post("/admin/users", json={
            "email": "weak2@example.com",
            "password": "password1",
            "name": "Weak Pwd 2",
            "role": "user",
        }, headers=admin_headers)
        assert response.status_code == 400
        assert "uppercase" in response.json()["detail"]

    def test_admin_create_user_no_lowercase(self, client, admin_headers):
        response = client.post("/admin/users", json={
            "email": "weak3@example.com",
            "password": "PASSWORD!",
            "name": "Weak Pwd 3",
            "role": "user",
        }, headers=admin_headers)
        assert response.status_code == 400
        assert "lowercase" in response.json()["detail"]

    def test_admin_create_user_no_special(self, client, admin_headers):
        response = client.post("/admin/users", json={
            "email": "weak4@example.com",
            "password": "Password1",
            "name": "Weak Pwd 4",
            "role": "user",
        }, headers=admin_headers)
        assert response.status_code == 400
        assert "special character" in response.json()["detail"]

    def test_admin_create_user_valid_password(self, client, admin_headers):
        response = client.post("/admin/users", json={
            "email": "strong@example.com",
            "password": "StrongPw1!",
            "name": "Strong User",
            "role": "user",
        }, headers=admin_headers)
        assert response.status_code == 201


class TestPasswordPolicyChangePassword:
    """Change password must enforce password policy."""

    def test_change_password_weak(self, client, test_user, auth_headers):
        response = client.put("/auth/me/password", json={
            "current_password": "Testpass123!",
            "new_password": "short",
        }, headers=auth_headers)
        assert response.status_code == 400
        assert "at least 8 characters" in response.json()["detail"]

    def test_change_password_no_uppercase(self, client, test_user, auth_headers):
        response = client.put("/auth/me/password", json={
            "current_password": "Testpass123!",
            "new_password": "newpassword1",
        }, headers=auth_headers)
        assert response.status_code == 400
        assert "uppercase" in response.json()["detail"]

    def test_change_password_no_lowercase(self, client, test_user, auth_headers):
        response = client.put("/auth/me/password", json={
            "current_password": "Testpass123!",
            "new_password": "NEWPASSWORD!",
        }, headers=auth_headers)
        assert response.status_code == 400
        assert "lowercase" in response.json()["detail"]

    def test_change_password_no_special(self, client, test_user, auth_headers):
        response = client.put("/auth/me/password", json={
            "current_password": "Testpass123!",
            "new_password": "NewValid1",
        }, headers=auth_headers)
        assert response.status_code == 400
        assert "special character" in response.json()["detail"]

    def test_change_password_valid(self, client, test_user, auth_headers):
        response = client.put("/auth/me/password", json={
            "current_password": "Testpass123!",
            "new_password": "NewValid1!",
        }, headers=auth_headers)
        assert response.status_code == 200


# ═══════════════════════════════════════════════════════════
#  3. COOKIE-BASED AUTH
# ═══════════════════════════════════════════════════════════

class TestCookieAuth:
    """httpOnly cookie authentication."""

    def test_login_sets_cookie(self, client, test_user):
        response = client.post("/auth/login", json={
            "email": "test@example.com",
            "password": "Testpass123!",
        })
        assert response.status_code == 200
        # TestClient stores cookies; check the response set-cookie header
        cookie = response.cookies.get("access_token")
        assert cookie is not None

    def test_register_sets_cookie(self, client):
        response = client.post("/auth/register", json={
            "email": "cookie@example.com",
            "password": "CookiePass1!",
            "name": "Cookie User",
        })
        assert response.status_code == 200
        cookie = response.cookies.get("access_token")
        assert cookie is not None

    def test_cookie_used_for_auth(self, client, test_user):
        """After login, /auth/me should work via cookie without Authorization header."""
        # Login first to get the cookie set
        login_resp = client.post("/auth/login", json={
            "email": "test@example.com",
            "password": "Testpass123!",
        })
        assert login_resp.status_code == 200

        # Now call /auth/me without Authorization header — cookie should be sent by TestClient
        me_resp = client.get("/auth/me")
        assert me_resp.status_code == 200
        assert me_resp.json()["email"] == "test@example.com"

    def test_logout_clears_cookie(self, client, test_user):
        """After logout, /auth/me should fail."""
        # Login
        client.post("/auth/login", json={
            "email": "test@example.com",
            "password": "Testpass123!",
        })
        # Verify we're authenticated
        assert client.get("/auth/me").status_code == 200

        # Logout
        logout_resp = client.post("/auth/logout")
        assert logout_resp.status_code == 200

        # Now /auth/me should fail
        me_resp = client.get("/auth/me")
        assert me_resp.status_code == 401


# ═══════════════════════════════════════════════════════════
#  4. TOKEN TAMPERING / LOCALSTORAGE MANIPULATION
# ═══════════════════════════════════════════════════════════

class TestTokenTampering:
    """Forged or modified tokens must be rejected."""

    def test_invalid_token(self, client):
        """Completely fake token → 401."""
        response = client.get("/auth/me", headers={
            "Authorization": "Bearer fake.token.here",
        })
        assert response.status_code == 401

    def test_expired_token(self, client, test_user):
        """Token with tampered expiry should fail validation."""
        # Create a token with a fake secret (simulates localStorage tampering)
        from jose import jwt
        tampered = jwt.encode(
            {"sub": str(test_user.id), "exp": 0},
            "wrong-secret",
            algorithm="HS256",
        )
        response = client.get("/auth/me", headers={
            "Authorization": f"Bearer {tampered}",
        })
        assert response.status_code == 401

    def test_token_with_wrong_secret(self, client, test_user):
        """Token signed with a different secret → 401."""
        from jose import jwt
        from datetime import datetime, timedelta
        fake_token = jwt.encode(
            {"sub": str(test_user.id), "exp": datetime.utcnow() + timedelta(hours=1)},
            "attacker-secret-key",
            algorithm="HS256",
        )
        response = client.get("/auth/me", headers={
            "Authorization": f"Bearer {fake_token}",
        })
        assert response.status_code == 401

    def test_token_with_nonexistent_user(self, client):
        """Valid token signature but for user that doesn't exist → 401."""
        token = create_access_token({"sub": "99999"})
        response = client.get("/auth/me", headers={
            "Authorization": f"Bearer {token}",
        })
        assert response.status_code == 401

    def test_role_escalation_via_token(self, client, test_user, auth_headers):
        """Regular user token cannot access admin routes regardless of any client-side manipulation."""
        response = client.get("/admin/users", headers=auth_headers)
        assert response.status_code == 403

    def test_no_auth_header_no_cookie(self, client):
        """No token at all → 401."""
        response = client.get("/auth/me")
        assert response.status_code == 401
