import {
  auth,
  createUserWithEmailAndPassword,
  googleProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
} from '../../services/firebase.js';

export const withAuth = (Base) => class extends Base {
  openAuth(mode = 'login') {
    this.authMode = mode;
    this.authError = '';
    this.renderRoot?.querySelector('#auth-dialog')?.showModal();
  }

  closeAuth() {
    this.renderRoot?.querySelector('#auth-dialog')?.close();
  }

  async handleAuthSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = form.email.value.trim();
    const password = form.password.value;
    this.authLoading = true;
    this.authError = '';

    try {
      if (this.authMode === 'signup') {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      this.closeAuth();
    } catch (error) {
      this.authError = this.authErrorMessage(error.code);
    } finally {
      this.authLoading = false;
    }
  }

  async handleGoogleSignIn() {
    this.authLoading = true;
    this.authError = '';
    try {
      await signInWithPopup(auth, googleProvider);
      this.closeAuth();
    } catch (error) {
      this.authError = this.authErrorMessage(error.code);
    } finally {
      this.authLoading = false;
    }
  }

  authErrorMessage(code) {
    const messages = {
      'auth/invalid-credential': 'E-mail ou senha incorretos.',
      'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
      'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
      'auth/popup-closed-by-user': 'A janela de login foi fechada.',
      'auth/operation-not-allowed': 'Este método ainda não foi ativado no Firebase.',
    };
    return messages[code] || 'Não foi possível concluir o acesso. Tente novamente.';
  }
};
