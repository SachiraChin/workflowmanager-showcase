import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Loader2, UserPlus } from "lucide-react";
import { api } from "@/core/api";

interface InvitationSignupPageProps {
  onLoginSuccess: (user: { user_id: string; email?: string | null; username: string; role?: string | null }) => void;
}

interface PasswordStrength {
  score: number;
  label: string;
}

function getPasswordStrength(password: string): PasswordStrength {
  if (!password) {
    return { score: 0, label: "No password" };
  }

  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  const labels = ["Very weak", "Weak", "Fair", "Good", "Strong", "Very strong"];
  return {
    score,
    label: labels[score],
  };
}

export function InvitationSignupPage({ onLoginSuccess }: InvitationSignupPageProps) {
  const params = useParams<{ invitationCode?: string; "*": string }>();
  const location = useLocation();

  const invitationCode = useMemo(() => {
    const pathCode = params.invitationCode || params["*"];
    const queryCode = new URLSearchParams(location.search).get("code") || "";
    const rawCode = (pathCode || queryCode || "").trim();
    if (!rawCode) return "";
    try {
      return decodeURIComponent(rawCode);
    } catch {
      return rawCode;
    }
  }, [params, location.search]);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [isCheckingInvitation, setIsCheckingInvitation] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [remainingUses, setRemainingUses] = useState<number | null>(null);
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);

  useEffect(() => {
    const checkInvitation = async () => {
      if (!invitationCode) {
        setInvitationError("Invitation code is missing from URL");
        setIsCheckingInvitation(false);
        return;
      }

      setIsCheckingInvitation(true);
      setInvitationError(null);

      try {
        const data = await api.getInvitationStatus(invitationCode);
        setRemainingUses(data.remaining_uses);
      } catch (err) {
        setInvitationError((err as Error).message || "Invitation is invalid or expired");
      } finally {
        setIsCheckingInvitation(false);
      }
    };

    checkInvitation();
  }, [invitationCode]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!invitationCode) {
        setSubmitError("Invitation code is missing from URL");
        return;
      }

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        const data = await api.registerWithInvitation({
          invitation_code: invitationCode,
          username,
          password,
          email: email.trim() ? email.trim() : undefined,
        });

        onLoginSuccess({
          user_id: data.user_id,
          email: data.email,
          username: data.username,
          role: data.role,
        });
      } catch (err) {
        setSubmitError((err as Error).message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [invitationCode, username, password, email, onLoginSuccess]
  );

  if (isCheckingInvitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Create account</CardTitle>
          <CardDescription>
            Create a new account using your invitation link
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invitationError ? (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertDescription>{invitationError}</AlertDescription>
              </Alert>
              <p className="text-xs text-muted-foreground text-center">
                Already have an account? <Link to="/login" className="underline">Login</Link>
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {typeof remainingUses === "number" && (
                <Alert>
                  <AlertDescription>
                    Invitation uses remaining: {remainingUses}
                  </AlertDescription>
                </Alert>
              )}

              {submitError && (
                <Alert variant="destructive">
                  <AlertDescription>{submitError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Choose a username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isSubmitting}
                  required
                  autoFocus
                  autoComplete="username"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email (optional)</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSubmitting}
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Create a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  required
                  autoComplete="new-password"
                />
                <div className="space-y-1">
                  <Progress value={passwordStrength.score * 20} />
                  <p className="text-xs text-muted-foreground">
                    Password strength: {passwordStrength.label}
                  </p>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  <>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Create account
                  </>
                )}
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                Already have an account? <Link to="/login" className="underline">Login</Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
