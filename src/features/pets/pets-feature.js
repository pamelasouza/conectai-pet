import {
  addDoc,
  analyzePetImage,
  collection,
  db,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
} from '../../services/firebase.js';

export const withPets = (Base) => class extends Base {
  openPetForm() {
    if (!this.currentUser) {
      this.openAuth('login');
      return;
    }
    this.petError = '';
    this.petFormMode = 'profile';
    this.petDraft = this.emptyPetDraft();
    this.renderRoot?.querySelector('#pet-dialog')?.showModal();
  }

  openLostPetForm() {
    if (!this.currentUser) {
      this.openAuth('login');
      return;
    }
    this.petError = '';
    this.petFormMode = 'lost';
    this.petDraft = this.emptyPetDraft();
    this.renderRoot?.querySelector('#pet-dialog')?.showModal();
  }

  emptyPetDraft() {
    return { name: '', species: '', breed: '', color: '', notes: '', photoUrl: '' };
  }

  updatePetDraft(field, event) {
    let value = event.target.value;
    if (field === 'name') value = value.slice(0, 15);
    this.petDraft = { ...this.petDraft, [field]: value };
  }

  async handlePetPhotoChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.petError = 'Escolha um arquivo de imagem válido.';
      return;
    }

    this.petError = '';
    this.petAnalyzing = true;
    this.petDraft = { ...this.petDraft, photoUrl: URL.createObjectURL(file) };
    try {
      const base64 = await this.fileToBase64(file);
      const detected = await analyzePetImage(base64, file.type);
      this.petDraft = {
        ...this.petDraft,
        name: detected.name || this.petDraft.name,
        species: ['cachorro', 'gato', 'outro'].includes(detected.species) ? detected.species : this.petDraft.species,
        breed: detected.breed || '',
        color: detected.color || '',
        notes: detected.notes || '',
      };
    } catch (error) {
      console.error('Erro ao reconhecer características do pet:', error);
      this.petError = 'Não foi possível reconhecer a foto. Preencha os dados manualmente.';
    } finally {
      this.petAnalyzing = false;
    }
  }

  closePetForm() {
    this.renderRoot?.querySelector('#pet-dialog')?.close();
  }

  async handlePetSubmit(event) {
    event.preventDefault();
    if (!this.currentUser) return;
    const form = event.currentTarget;
    this.petLoading = true;
    this.petError = '';
    try {
      const petData = {
        name: form.name.value.trim(),
        species: form.species.value,
        breed: form.breed.value.trim(),
        color: form.color.value.trim(),
        notes: form.notes.value.trim(),
        photoUrl: this.petDraft.photoUrl || '',
        createdAt: serverTimestamp(),
      };
      if (this.petFormMode === 'lost') {
        await addDoc(collection(db, 'lostReports'), {
          ...petData,
          reporterId: this.currentUser.uid,
          status: 'active',
        });
        await this.findMatchesForLostPet(petData);
      } else {
        await addDoc(collection(db, 'users', this.currentUser.uid, 'pets'), {
          ...petData,
          ownerId: this.currentUser.uid,
        });
      }
      form.reset();
      this.closePetForm();
    } catch (error) {
      console.error('Erro ao cadastrar pet:', error);
      this.petError = 'Não foi possível salvar o pet. Tente novamente.';
    } finally {
      this.petLoading = false;
    }
  }

  async findMatchesForLostPet(source) {
    const snapshot = await getDocs(collection(db, 'foundPets'));
    this.matches = snapshot.docs
      .map((match) => ({ id: match.id, ...match.data() }))
      .map((match) => ({ ...match, score: this.matchScore(source, match) }))
      .filter((match) => match.score >= 35)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
    this.matchSearchMessage = this.matches.length
      ? `${this.matches.length} possível(is) match(es) encontrado(s) entre os pets encontrados.`
      : 'Pet perdido cadastrado. Ainda não encontramos um registro compatível em pets encontrados.';
    this.renderRoot?.querySelector('#matches')?.scrollIntoView({ behavior: 'smooth' });
  }

  async removePet(petId) {
    if (!this.currentUser) return;
    try {
      await deleteDoc(doc(db, 'users', this.currentUser.uid, 'pets', petId));
    } catch (error) {
      console.error('Erro ao remover pet:', error);
      this.petError = 'Não foi possível remover o pet.';
    }
  }
};
