import {
  collection,
  db,
  doc,
  getDocs,
  getDownloadURL,
  query,
  ref,
  serverTimestamp,
  storage,
  uploadBytes,
  where,
  writeBatch,
} from '../../services/firebase.js';
import adoptionMaskUrl from '../../assets/mascara.png';
import {
  deleteAdoptionSessionMedia,
  loadAdoptionSessionMedia,
  saveAdoptionSessionMedia,
} from './adoption-session.js';

const sessionIdKey = 'cademeupet:adoption-session-id';
const sessionDraftKey = 'cademeupet:adoption-draft';

function normalizeListingName(name) {
  return name.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');
}

function normalizeListingPhone(phone) {
  return phone.replace(/\D/g, '');
}

async function createListingId(ownerId, name, phone) {
  const identity = new TextEncoder().encode(`${ownerId}\0${normalizeListingName(name)}\0${normalizeListingPhone(phone)}`);
  const digest = await crypto.subtle.digest('SHA-256', identity);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const withAdoption = (Base) => class extends Base {
  async claimAdoptionSession() {
    let sessionId = sessionStorage.getItem(sessionIdKey);
    let isNewSession = !sessionId;
    sessionId ||= crypto.randomUUID();

    if (navigator.locks) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const acquired = await this.acquireAdoptionSessionLock(sessionId);
        if (acquired) {
          if (isNewSession) sessionStorage.removeItem(sessionDraftKey);
          sessionStorage.setItem(sessionIdKey, sessionId);
          this._adoptionSessionId = sessionId;
          return;
        }
        isNewSession = true;
        sessionId = crypto.randomUUID();
      }
      throw new Error('Não foi possível reservar uma sessão exclusiva para esta aba.');
    }

    if (window.opener) {
      isNewSession = true;
      sessionId = crypto.randomUUID();
    }
    if (isNewSession) sessionStorage.removeItem(sessionDraftKey);
    sessionStorage.setItem(sessionIdKey, sessionId);
    this._adoptionSessionId = sessionId;
  }

  acquireAdoptionSessionLock(sessionId) {
    return new Promise((resolve, reject) => {
      navigator.locks.request(`cademeupet-adoption:${sessionId}`, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }

        let releaseLock;
        const lockReleased = new Promise((done) => {
          releaseLock = done;
        });
        this._releaseAdoptionSessionLock = releaseLock;
        resolve(true);
        await lockReleased;
      }).catch(reject);
    });
  }

  releaseAdoptionSessionLock() {
    this._releaseAdoptionSessionLock?.();
    this._releaseAdoptionSessionLock = null;
  }

  async restoreAdoptionSession() {
    try {
      await this.claimAdoptionSession();

      const savedDraft = sessionStorage.getItem(sessionDraftKey);
      if (savedDraft) {
        const session = JSON.parse(savedDraft);
        if (!session.draft || typeof session.draft !== 'object') {
          throw new Error('Os dados salvos do formulário estão inválidos.');
        }
        this.adoptionDraft = {
          ...this.emptyAdoptionDraft(),
          ...session.draft,
          publish: 'no',
          vaccinations: Array.isArray(session.draft.vaccinations) ? session.draft.vaccinations : [],
          characteristics: Array.isArray(session.draft.characteristics) ? session.draft.characteristics : [],
        };
        this.adoptionStateSearch = typeof session.stateSearch === 'string' ? session.stateSearch : '';
        this.adoptionShareMessage = typeof session.shareMessage === 'string' ? session.shareMessage : '';
      }

      const media = await loadAdoptionSessionMedia(this._adoptionSessionId);
      if (media?.photo instanceof Blob) {
        const file = new File([media.photo], media.photoName || 'foto-animal', {
          type: media.photoType || media.photo.type || 'image/jpeg',
        });
        this.adoptionPhotos = [{ file, url: URL.createObjectURL(file) }];
      }
      if (typeof media?.previewUrl === 'string') this.adoptionPreviewUrl = media.previewUrl;

      if (this.adoptionDraft.state) {
        const city = this.adoptionDraft.city;
        const state = this.adoptionDraft.state;
        await this.loadAdoptionCities(state);
        this.adoptionDraft = { ...this.adoptionDraft, city };
      }
    } catch (error) {
      console.error('Não foi possível restaurar a sessão de adoção:', error);
      this.adoptionError = 'Não foi possível restaurar seus dados nesta aba.';
    } finally {
      this._adoptionSessionReady = true;
      this.requestUpdate();
    }
  }

  persistAdoptionSession(changedProperties) {
    if (!this._adoptionSessionReady || !this._adoptionSessionId) return;

    if (changedProperties.has('adoptionDraft')
      || changedProperties.has('adoptionStateSearch')
      || changedProperties.has('adoptionShareMessage')) {
      try {
        sessionStorage.setItem(sessionDraftKey, JSON.stringify({
          draft: this.adoptionDraft,
          stateSearch: this.adoptionStateSearch,
          shareMessage: this.adoptionShareMessage,
        }));
      } catch (error) {
        console.error('Não foi possível salvar o rascunho da adoção:', error);
        this.adoptionError = 'Não foi possível salvar o rascunho nesta aba.';
      }
    }

    if (changedProperties.has('adoptionPhotos') || changedProperties.has('adoptionPreviewUrl')) {
      const sessionId = this._adoptionSessionId;
      const photo = this.adoptionPhotos[0]?.file || null;
      const media = {
        photo,
        photoName: photo?.name || '',
        photoType: photo?.type || '',
        previewUrl: this.adoptionPreviewUrl || '',
      };
      this._adoptionMediaSaveQueue = this._adoptionMediaSaveQueue
        .then(() => saveAdoptionSessionMedia(sessionId, media))
        .catch((error) => {
          console.error('Não foi possível salvar a foto e a arte da adoção:', error);
          this.adoptionError = 'Não foi possível salvar a foto nesta aba. Mantenha esta página aberta.';
        });
    }
  }

  beginFreshAdoptionSession() {
    try {
      sessionStorage.removeItem(sessionDraftKey);
    } catch (error) {
      console.error('Não foi possível reiniciar a sessão de adoção:', error);
      this.adoptionError = 'Não foi possível reiniciar o formulário. Tente novamente.';
      return false;
    }

    if (this._adoptionSessionId) {
      const sessionId = this._adoptionSessionId;
      this._adoptionMediaSaveQueue = this._adoptionMediaSaveQueue
        .then(() => deleteAdoptionSessionMedia(sessionId))
        .catch((error) => {
          console.error('Não foi possível limpar os dados da sessão anterior:', error);
          this.adoptionError = 'O formulário foi reiniciado, mas os dados locais antigos não puderam ser removidos.';
        });
    }
    return true;
  }

  emptyAdoptionDraft() {
    return {
      name: '', species: '', sex: '', size: '', age: '', ageUnknown: false, ageUnit: 'anos', isNeutered: '', vaccinations: [], vaccinationOther: '',
      characteristics: [], description: '', getsAlongWithAnimals: '', getsAlongWithChildren: '',
      neighborhood: '', state: '', city: '', responsibleName: '', phone: '', publish: 'no'
    };
  }

  updateAdoptionField(field, event) {
    let value = event.target.value;
    if (field === 'phone') value = this.maskPhone(value);
    if (field === 'description') value = value.slice(0, 50);
    if (field === 'age') {
      value = value.replace(/[^\d,]/g, '');
      const commaIndex = value.indexOf(',');
      if (commaIndex !== -1) {
        value = `${value.slice(0, commaIndex + 1)}${value.slice(commaIndex + 1).replace(/,/g, '').slice(0, 2)}`;
      }
      value = value.slice(0, 5);
    }
    if (field === 'name') {
      value = value.trimStart();
      const words = value.trimEnd().split(/\s+/).filter(Boolean);
      if (words.length > 3) value = words.slice(0, 3).join(' ');
    }
    if (field === 'responsibleName') value = value.slice(0, 15);
    const nextDraft = { ...this.adoptionDraft, [field]: value };
    if (field === 'species') {
      const availableVaccinations = this.adoptionVaccinationOptions(value);
      nextDraft.vaccinations = nextDraft.vaccinations.filter((item) => availableVaccinations.includes(item));
      if (!nextDraft.vaccinations.includes('Outra')) nextDraft.vaccinationOther = '';
    }
    this.adoptionDraft = nextDraft;
  }

  toggleAgeUnknown(event) {
    this.adoptionDraft = {
      ...this.adoptionDraft,
      ageUnknown: event.target.checked,
      age: '',
    };
  }

  async updateAdoptionStateSearch(event) {
    const value = event.target.value;
    this.adoptionStateSearch = value;
    const normalizedValue = value.trim().toLocaleLowerCase('pt-BR');
    const state = this.constructor.brazilStates.find(([code, name]) =>
      code.toLocaleLowerCase('pt-BR') === normalizedValue
      || name.toLocaleLowerCase('pt-BR') === normalizedValue,
    );
    if (!state) {
      this.adoptionCityRequestId++;
      this.adoptionCityLoading = false;
      this.adoptionDraft = { ...this.adoptionDraft, state: '', city: '' };
      this.adoptionCities = [];
      this.adoptionCityError = '';
      return;
    }
    this.adoptionStateSearch = state[1];
    if (this.adoptionDraft.state === state[0]) return;
    await this.loadAdoptionCities(state[0]);
  }

  async loadAdoptionCities(state) {
    const requestId = ++this.adoptionCityRequestId;
    this.adoptionDraft = { ...this.adoptionDraft, state, city: '' };
    this.adoptionCities = [];
    this.adoptionCityError = '';
    this.adoptionStateSearch = this.constructor.brazilStates.find(([code]) => code === state)?.[1] || '';
    if (!state) return;

    this.adoptionCityLoading = true;
    try {
      const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state}/municipios?orderBy=nome`);
      if (!response.ok) throw new Error('Falha ao carregar municípios');
      const cities = await response.json();
      if (requestId === this.adoptionCityRequestId) this.adoptionCities = cities;
    } catch (error) {
      if (requestId !== this.adoptionCityRequestId) return;
      console.error(error);
      this.adoptionCityError = 'Não foi possível carregar as cidades. Tente selecionar o estado novamente.';
    } finally {
      if (requestId === this.adoptionCityRequestId) this.adoptionCityLoading = false;
    }
  }

  static brazilStates = [
    ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'], ['BA', 'Bahia'],
    ['CE', 'Ceará'], ['DF', 'Distrito Federal'], ['ES', 'Espírito Santo'], ['GO', 'Goiás'],
    ['MA', 'Maranhão'], ['MT', 'Mato Grosso'], ['MS', 'Mato Grosso do Sul'], ['MG', 'Minas Gerais'],
    ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'], ['PE', 'Pernambuco'], ['PI', 'Piauí'],
    ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'], ['RS', 'Rio Grande do Sul'],
    ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'], ['SP', 'São Paulo'],
    ['SE', 'Sergipe'], ['TO', 'Tocantins'],
  ];

  async fillAdoptionTestData() {
    this.adoptionTestDataLoading = true;
    this.adoptionError = '';
    try {
      const [citiesResponse, photoResponse] = await Promise.all([
        fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados/SP/municipios?orderBy=nome'),
        fetch('https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=1200&q=85'),
      ]);
      if (!citiesResponse.ok || !photoResponse.ok) throw new Error('Falha ao carregar os dados de demonstração.');

      const [cities, photoBlob] = await Promise.all([citiesResponse.json(), photoResponse.blob()]);
      const photoFile = new File([photoBlob], 'foto-teste-cachorro.jpg', { type: photoBlob.type || 'image/jpeg' });
      const city = cities.find((item) => item.nome === 'Campinas')?.nome || cities[0]?.nome || '';
      for (const photo of this.adoptionPhotos) if (photo.url) URL.revokeObjectURL(photo.url);

      this.adoptionCities = cities;
      this.adoptionCityError = '';
      this.adoptionDraft = {
        ...this.emptyAdoptionDraft(),
        name: 'Tiquinho Demo',
        species: 'Cachorro',
        sex: 'Macho',
        size: 'Pequeno',
        age: '2,5',
        ageUnit: 'anos',
        isNeutered: 'Sim',
        vaccinations: ['V8 ou V10 (cachorro)', 'Antirrábica (cachorro/gato)'],
        characteristics: ['Carinhoso', 'Brincalhão', 'Calmo'],
        description: 'Muito companheiro e adora passear.',
        getsAlongWithAnimals: 'Sim',
        getsAlongWithChildren: 'Sim',
        neighborhood: 'Centro',
        state: 'SP',
        city,
        responsibleName: 'Pessoa Teste',
        phone: this.maskPhone('11988887777'),
        publish: 'no',
      };
      this.adoptionStateSearch = 'São Paulo';
      this.adoptionPhotos = [{ file: photoFile, url: URL.createObjectURL(photoFile) }];
      this.adoptionPreviewUrl = '';
    } catch (error) {
      console.error(error);
      this.adoptionError = 'Não foi possível carregar os dados de teste. Verifique sua conexão e tente novamente.';
    } finally {
      this.adoptionTestDataLoading = false;
    }
  }

  adoptionVaccinationOptions(species = this.adoptionDraft.species) {
    const all = [
      'V8 ou V10 (cachorro)',
      'Antirrábica (cachorro/gato)',
      'Tríplice felina (gato)',
      'Quádrupla felina (gato)',
      'Quíntupla felina (gato)',
      'Não tomou',
      'Não sei',
      'Outra',
    ];
    if (species === 'Cachorro') {
      return all.filter((item) => item.includes('cachorro') || ['Não tomou', 'Não sei', 'Outra'].includes(item));
    }
    if (species === 'Gato') {
      return all.filter((item) => item.includes('gato') || ['Não tomou', 'Não sei', 'Outra'].includes(item));
    }
    return all;
  }

  maskPhone(value) {
    const digits = value.replace(/[^0-9]/g, '').slice(0, 11);
    if (digits.length <= 2) return digits.length ? `(${digits}` : '';
    const areaCode = `(${digits.slice(0, 2)})`;
    const subscriber = digits.slice(2);
    const isMobile = subscriber.startsWith('9');
    const prefixLength = isMobile ? 5 : 4;
    if (subscriber.length <= prefixLength) return `${areaCode} ${subscriber}`;
    return `${areaCode} ${subscriber.slice(0, prefixLength)}-${subscriber.slice(prefixLength)}`;
  }

  capitalizeWords(value) {
    return value
      .trim()
      .toLowerCase()
      .replace(/(^|\s|[-'])\S/g, (character) => character.toUpperCase());
  }

  toggleVaccination(vaccination) {
    const selected = this.adoptionDraft.vaccinations.includes(vaccination);
    let vaccinations;
    if (selected) {
      vaccinations = this.adoptionDraft.vaccinations.filter((item) => item !== vaccination);
    } else if (['Não tomou', 'Não sei'].includes(vaccination)) {
      vaccinations = [vaccination];
    } else {
      vaccinations = this.adoptionDraft.vaccinations.filter((item) => !['Não tomou', 'Não sei'].includes(item));
      vaccinations = [...vaccinations, vaccination];
    }
    this.adoptionDraft = {
      ...this.adoptionDraft,
      vaccinations,
      vaccinationOther: vaccination === 'Outra' && selected ? '' : this.adoptionDraft.vaccinationOther,
    };
  }

  toggleCharacteristic(characteristic) {
    const isSelected = this.adoptionDraft.characteristics.includes(characteristic);
    if (!isSelected && this.adoptionDraft.characteristics.length >= 3) {
      this.adoptionError = 'Selecione no máximo 3 características de personalidade.';
      return;
    }
    const selected = isSelected
      ? this.adoptionDraft.characteristics.filter((item) => item !== characteristic)
      : [...this.adoptionDraft.characteristics, characteristic];
    this.adoptionDraft = { ...this.adoptionDraft, characteristics: selected };
    this.adoptionError = '';
  }

  async handleAdoptionPhotos(event) {
    const incoming = [...event.target.files];
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const valid = incoming.filter((file) => validTypes.includes(file.type) && file.size <= 8 * 1024 * 1024);
    if (valid.length !== incoming.length) {
      this.adoptionError = 'Envie uma imagem JPG, JPEG, PNG ou WebP com até 8 MB.';
    } else this.adoptionError = '';
    for (const photo of this.adoptionPhotos) if (photo.url) URL.revokeObjectURL(photo.url);
    this.adoptionPhotos = valid.slice(0, 1).map((file) => ({ file, url: URL.createObjectURL(file) }));
    this.adoptionPreviewUrl = '';
  }

  removeAdoptionPhoto(index) {
    const photo = this.adoptionPhotos[index];
    if (photo?.url) URL.revokeObjectURL(photo.url);
    this.adoptionPhotos = this.adoptionPhotos.filter((_, itemIndex) => itemIndex !== index);
    this.adoptionPreviewUrl = '';
  }

  restartAdoptionForm(event) {
    if (!this.beginFreshAdoptionSession()) return;
    event.currentTarget.form?.reset();
    for (const photo of this.adoptionPhotos) {
      if (photo.url) URL.revokeObjectURL(photo.url);
    }
    this.adoptionPhotos = [];
    this.adoptionDraft = this.emptyAdoptionDraft();
    this.adoptionCities = [];
    this.adoptionStateSearch = '';
    this.adoptionCityRequestId++;
    this.adoptionCityLoading = false;
    this.adoptionCityError = '';
    this.adoptionError = '';
    this.adoptionPreviewUrl = '';
    this.adoptionShareMessage = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async optimizeImage(file, maxSize = 1600) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  }

  loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
  }

  async generateAdoptionArt() {
    const draft = this.adoptionDraft;
    this.adoptionPreviewUrl = '';
    if (draft.description.length > 50) {
      this.adoptionError = 'A descrição complementar pode ter no máximo 50 caracteres.';
      return;
    }
    const nameValid = draft.name.trim();
    const nameWordCount = draft.name.trim().split(/\s+/).filter(Boolean).length;
    const cityValid = this.adoptionCities.some((city) => city.nome.toLocaleLowerCase('pt-BR') === draft.city.trim().toLocaleLowerCase('pt-BR'));
    const locationValid = draft.neighborhood.trim() && draft.state && cityValid && draft.phone.trim();
    const speciesValid = draft.species;
    const characteristicsValid = draft.characteristics.length || draft.description.trim();
    if (!nameValid || nameWordCount > 3 || !draft.responsibleName.trim() || !speciesValid || !draft.size || !locationValid || !characteristicsValid || !this.adoptionPhotos.length) {
      this.adoptionError = 'Adicione uma foto e preencha nome (até 3 palavras), espécie, porte, responsável, telefone, bairro, estado, cidade e pelo menos uma característica ou descrição.';
      return;
    }
    if (!draft.isNeutered) {
      this.adoptionError = 'Informe se o animal é castrado.';
      return;
    }
    if (!draft.vaccinations.length) {
      this.adoptionError = 'Informe as vacinas tomadas ou selecione “Não tomou” ou “Não sei”.';
      return;
    }
    if (draft.age && (!/^\d{1,2}(,\d{1,2})?$/.test(draft.age) || Number(draft.age.replace(',', '.')) > 99)) {
      this.adoptionError = 'Informe a idade com números e, se necessário, vírgula decimal (ex.: 2,5).';
      return;
    }
    if (draft.vaccinations.includes('Outra') && !draft.vaccinationOther.trim()) {
      this.adoptionError = 'Informe qual outra vacina foi aplicada.';
      return;
    }
    this.adoptionError = '';
    this.adoptionLoading = true;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1912;
      const ctx = canvas.getContext('2d');
      const artworkScale = canvas.width / 1695;
      ctx.scale(artworkScale, artworkScale);
      ctx.fillStyle = '#f5e5ce';
      ctx.fillRect(0, 0, 1695, 3000);

      const image = await this.loadImage(this.adoptionPhotos[0].url);
      const photoX = 114, photoY = 260, photoW = 1469, photoH = 2082;
      const photoScale = Math.max(photoW / image.width, photoH / image.height);
      const sourceWidth = photoW / photoScale;
      const sourceHeight = photoH / photoScale;
      ctx.save();
      ctx.drawImage(
        image,
        Math.max(0, (image.width - sourceWidth) / 2),
        Math.max(0, (image.height - sourceHeight) / 2),
        sourceWidth,
        sourceHeight,
        photoX,
        photoY,
        photoW,
        photoH,
      );
      ctx.restore();
      const mask = await this.loadImage(adoptionMaskUrl);
      const maskExpansion = 6 / artworkScale;
      ctx.drawImage(mask, -1 / artworkScale, 0, 1695 + maskExpansion, 3000 + maskExpansion);

      const wrapText = (text, maxWidth, fontSize) => {
        ctx.font = `500 ${fontSize}px "Gabarito", sans-serif`;
        const lines = [];
        let line = '';
        for (const word of text.split(/\s+/).filter(Boolean)) {
          const candidate = line ? `${line} ${word}` : word;
          if (line && ctx.measureText(candidate).width > maxWidth) {
            lines.push(line);
            line = word;
          } else {
            line = candidate;
          }
        }
        if (line) lines.push(line);
        return lines;
      };
      const drawFitLine = (text, baseline, initialSize, minSize = 20) => {
        let size = initialSize;
        ctx.textAlign = 'center';
        ctx.font = `600 ${size}px "Outfit", sans-serif`;
        while (size > minSize && ctx.measureText(text).width > 1550) {
          size -= 1;
          ctx.font = `600 ${size}px "Outfit", sans-serif`;
        }
        ctx.fillText(text, 847, baseline, 1550);
      };

      const metadata = [
        draft.ageUnknown ? 'Idade não informada' : draft.age.trim() ? `${draft.age.trim()} ${draft.ageUnit}` : '',
        draft.size ? `Porte ${draft.size.toLocaleLowerCase('pt-BR')}` : '',
        draft.sex,
        draft.isNeutered === 'Sim' ? 'Castrado' : draft.isNeutered === 'Não' ? 'Não castrado' : '',
      ].filter(Boolean).join(' • ');
      const health = draft.vaccinations.map((vaccination) => {
        if (vaccination === 'Não tomou') return 'Não tomou vacinas';
        if (vaccination === 'Outra' && draft.vaccinationOther.trim()) return draft.vaccinationOther.trim();
        return vaccination.replace(/\s*\([^)]*\)/g, '').trim();
      });
      const vaccineInformation = health.length ? `Vacinas: ${health.join(' • ')}` : '';
      const compatibilityText = (animals, children) => {
        if (animals === 'Sim' && children === 'Sim') return 'Se dá bem com outros animais e crianças';
        if (animals === 'Não' && children === 'Não') return 'Não se dá bem com outros animais nem com crianças';
        if (animals === 'Sim' && children === 'Não') return 'Se dá bem com outros animais, mas não com crianças';
        if (animals === 'Não' && children === 'Sim') return 'Não se dá bem com outros animais, mas sim com crianças';
        if (animals === 'Sim') return 'Se dá bem com outros animais';
        if (animals === 'Não') return 'Não se dá bem com outros animais';
        if (children === 'Sim') return 'Se dá bem com crianças';
        if (children === 'Não') return 'Não se dá bem com crianças';
        return '';
      };
      const compatibility = compatibilityText(draft.getsAlongWithAnimals, draft.getsAlongWithChildren);
      const personalityInformation = draft.characteristics.length
        ? draft.characteristics.join(' • ')
        : '';
      const descriptionInformation = draft.description.trim();
      const detailsWidth = 1400;
      const detailsHeight = 390;
      await document.fonts.load('500 56px "Gabarito"');
      await document.fonts.load('600 52px "Outfit"');
      const detailsFontSize = 56;
      const metadataLines = wrapText(metadata, detailsWidth, detailsFontSize);
      const vaccineLines = wrapText(vaccineInformation, detailsWidth, detailsFontSize);
      const compatibilityLines = wrapText(compatibility, detailsWidth, detailsFontSize);
      const descriptionLines = wrapText(descriptionInformation, detailsWidth, detailsFontSize);
      const contentGroups = [metadataLines, vaccineLines, compatibilityLines, personalityInformation ? [personalityInformation] : [], descriptionLines];
      const totalLines = contentGroups.reduce((total, lines) => total + lines.length, 0);
      const groupCount = contentGroups.filter((lines) => lines.length > 0).length;
      const lineHeight = detailsFontSize * 1.05;
      const groupSpacing = 8;
      const contentHeight = totalLines * lineHeight + Math.max(0, groupCount - 1) * groupSpacing;
      const overflow = Math.max(0, contentHeight - detailsHeight);
      let nameFontSize = Math.max(110, 200 - Math.ceil(overflow * 0.4));
      await document.fonts.load(`400 ${nameFontSize}px "Sniglet"`);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff3dc';
      ctx.font = `400 ${nameFontSize}px "Sniglet", system-ui`;
      while (nameFontSize > 48 && ctx.measureText(draft.name.trim()).width > 1300) {
        nameFontSize -= 2;
        ctx.font = `400 ${nameFontSize}px "Sniglet", system-ui`;
      }
      ctx.fillText(draft.name.trim(), 847, 2373, 1300);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff8e9';
      ctx.font = `500 ${detailsFontSize}px "Gabarito", sans-serif`;
      let detailsBaseline = 2490 - overflow;
      const drawDetailLines = (lines) => {
        if (!lines.length) return;
        lines.forEach((line) => {
          ctx.fillText(line, 847, detailsBaseline, detailsWidth);
          detailsBaseline += lineHeight;
        });
        detailsBaseline += groupSpacing;
      };
      drawDetailLines(metadataLines);
      drawDetailLines(vaccineLines);
      drawDetailLines(compatibilityLines);
      if (personalityInformation) {
        ctx.fillText(personalityInformation, 847, detailsBaseline, detailsWidth);
        detailsBaseline += lineHeight + groupSpacing;
      }
      drawDetailLines(descriptionLines);

      ctx.fillStyle = '#ffffff';
      const responsibleContact = [
        this.capitalizeWords(draft.responsibleName),
        draft.phone.trim(),
      ].filter(Boolean).join(' ');
      const stateCode = this.constructor.brazilStates.find(([code, stateName]) =>
        code === draft.state || stateName === draft.state,
      )?.[0];
      const cityWithState = [
        this.capitalizeWords(draft.city),
        stateCode ? `/${stateCode}` : '',
      ].join('');
      const locationContact = [
        this.capitalizeWords(draft.neighborhood),
        cityWithState,
      ].filter(Boolean).join(' - ');
      const contact = [responsibleContact, locationContact].filter(Boolean).join('  •  ');
      drawFitLine(contact, 2950, 58, 18);
      this.adoptionPreviewUrl = canvas.toDataURL('image/jpeg', 0.92);
      await this.updateComplete;
      this.renderRoot.querySelector('.adoption-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      console.error(error);
      this.adoptionError = 'Não foi possível gerar a arte. Tente novamente.';
    } finally {
      this.adoptionLoading = false;
    }
  }

  downloadAdoptionArt() {
    if (!this.adoptionPreviewUrl) return;
    const link = document.createElement('a');
    link.href = this.adoptionPreviewUrl;
    link.download = `conectai-pet-${this.adoptionDraft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'adocao'}.jpg`;
    link.click();
  }

  async shareAdoptionArt() {
    if (!this.adoptionPreviewUrl) return;
    this.adoptionShareMessage = '';
    const [dataUrlHeader, base64Data] = this.adoptionPreviewUrl.split(',');
    const mimeType = dataUrlHeader.match(/data:(.*?);base64/)?.[1] || 'image/jpeg';
    const binaryData = atob(base64Data);
    const imageData = Uint8Array.from(binaryData, (character) => character.charCodeAt(0));
    const file = new File([imageData], 'conectai-pet-adocao.jpg', { type: mimeType });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          title: 'Procura uma família',
          text: `${this.adoptionDraft.name} está procurando uma família!`,
          files: [file],
        });
        this.adoptionShareMessage = 'Compartilhamento concluído.';
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error(error);
        this.adoptionShareMessage = 'Não foi possível abrir o compartilhamento. Baixe a imagem e tente novamente.';
      }
    } else {
      this.downloadAdoptionArt();
      this.adoptionShareMessage = 'A imagem foi baixada. Compartilhe pelo aplicativo de sua preferência.';
    }
  }

  async saveAdoptionListing() {
    if (this.adoptionDraft.publish !== 'yes') return;
    if (!this.currentUser) { this.openAuth('login'); return false; }

    const draft = this.adoptionDraft;
    const name = draft.name.trim();
    const phone = draft.phone.trim();
    const matchingListings = await getDocs(query(
      collection(db, 'adoption_listings'),
      where('ownerId', '==', this.currentUser.uid),
      where('isPublished', '==', true),
      where('status', '==', 'available'),
    ));
    const matches = matchingListings.docs.filter((item) => {
      const listing = item.data();
      return normalizeListingName(listing.name || '') === normalizeListingName(name)
        && normalizeListingPhone(listing.phone || '') === normalizeListingPhone(phone);
    });
    const existingListing = matches
      .sort((left, right) => (right.data().updatedAt?.toMillis?.() || 0) - (left.data().updatedAt?.toMillis?.() || 0))[0];
    const listingId = existingListing?.id || await createListingId(this.currentUser.uid, name, phone);

    const photos = [];
    for (let index = 0; index < this.adoptionPhotos.length; index++) {
      const optimized = await this.optimizeImage(this.adoptionPhotos[index].file);
      const path = `adoption/${this.currentUser.uid}/${Date.now()}-${index}.jpg`;
      await uploadBytes(ref(storage, path), optimized, { contentType: 'image/jpeg' });
      photos.push(await getDownloadURL(ref(storage, path)));
    }
    const generatedArtResponse = await fetch(this.adoptionPreviewUrl);
    if (!generatedArtResponse.ok) throw new Error('Não foi possível preparar a arte para a galeria.');
    const generatedArt = await generatedArtResponse.blob();
    const generatedArtPath = `adoption/${this.currentUser.uid}/${listingId}-art.jpg`;
    await uploadBytes(ref(storage, generatedArtPath), generatedArt, { contentType: generatedArt.type || 'image/jpeg' });
    const publicPhoto = await getDownloadURL(ref(storage, generatedArtPath));
    const createdAt = existingListing?.data().createdAt || serverTimestamp();
    const animalId = existingListing?.data().animalId || listingId;
    const batch = writeBatch(db);
    batch.set(doc(db, 'animals', animalId), {
      ownerId: this.currentUser.uid, name, species: draft.species, sex: draft.sex, size: draft.size, age: draft.ageUnknown ? 'Não sei' : draft.age.trim(), ageUnit: draft.ageUnknown ? '' : draft.ageUnit,
      photos, characteristics: draft.characteristics, description: draft.description.trim(), isNeutered: draft.isNeutered || '',
      vaccinations: draft.vaccinations, vaccinationOther: draft.vaccinationOther.trim(),
      getsAlongWithAnimals: draft.getsAlongWithAnimals || '', getsAlongWithChildren: draft.getsAlongWithChildren || '',
      neighborhood: draft.neighborhood.trim(), state: draft.state, city: draft.city.trim(), responsibleName: draft.responsibleName.trim(), phone, createdAt, updatedAt: serverTimestamp(),
    }, { merge: true });
    batch.set(doc(db, 'adoption_listings', listingId), {
      animalId, ownerId: this.currentUser.uid, isPublished: true, publicationConsent: true,
      publicationConsentAt: existingListing?.data().publicationConsentAt || serverTimestamp(), status: 'available', photo: publicPhoto, photos,
      name, species: draft.species, sex: draft.sex, size: draft.size, age: draft.ageUnknown ? 'Não sei' : draft.age.trim(), ageUnit: draft.ageUnknown ? '' : draft.ageUnit, characteristics: draft.characteristics,
      description: draft.description.trim(), isNeutered: draft.isNeutered || '', vaccinations: draft.vaccinations, vaccinationOther: draft.vaccinationOther.trim(),
      getsAlongWithAnimals: draft.getsAlongWithAnimals || '',
      getsAlongWithChildren: draft.getsAlongWithChildren || '', neighborhood: draft.neighborhood.trim(), state: draft.state, city: draft.city.trim(),
      responsibleName: draft.responsibleName.trim(), phone,
      createdAt, updatedAt: serverTimestamp(),
    }, { merge: true });
    matches.filter((item) => item.id !== listingId).forEach((item) => {
      batch.update(item.ref, { status: 'replaced', updatedAt: serverTimestamp() });
    });
    await batch.commit();
    return true;
  }

  async loadAdoptionListings() {
    try {
      const snapshot = await getDocs(query(collection(db, 'adoption_listings'), where('isPublished', '==', true), where('status', '==', 'available')));
      this.adoptionListings = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    } catch (error) {
      console.error(error);
      this.adoptionListings = [];
    }
  }
};
