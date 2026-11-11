import { html, LitElement } from 'lit';
import logoUrl from '../assets/conectai_pet_branco.png';
import {
  auth,
  collection,
  db,
  onAuthStateChanged,
  onSnapshot,
  orderBy,
  query,
  signOut,
} from '../services/firebase.js';
import { withAdoption } from '../features/adoption/adoption-feature.js';
import { withAuth } from '../features/auth/auth-feature.js';
import { withMatching } from '../features/matching/matching-feature.js';
import { withPets } from '../features/pets/pets-feature.js';

class CadeMeuPetApp extends withMatching(withAuth(withPets(withAdoption(LitElement)))) {
  static properties = {
    previewUrl: { type: String },
    isAnalyzing: { type: Boolean },
    analysisResult: { type: String },
    currentUser: { state: true },
    authMode: { state: true },
    authError: { state: true },
    authLoading: { state: true },
    pets: { state: true },
    petError: { state: true },
    petLoading: { state: true },
    petDraft: { state: true },
    petAnalyzing: { state: true },
    isSearchingMatches: { state: true },
    matchSearchMessage: { state: true },
    flowMode: { state: true },
    matches: { state: true },
    petFormMode: { state: true },
    currentPage: { state: true },
    adoptionPhotos: { state: true },
    adoptionDraft: { state: true },
    adoptionCities: { state: true },
    adoptionStateSearch: { state: true },
    adoptionCityLoading: { state: true },
    adoptionCityError: { state: true },
    adoptionTestDataLoading: { state: true },
    adoptionPreviewUrl: { state: true },
    adoptionError: { state: true },
    adoptionLoading: { state: true },
    adoptionShareMessage: { state: true },
    adoptionListings: { state: true },
  };

  constructor() {
    super();
    this._adoptionSessionId = '';
    this._adoptionSessionReady = false;
    this._adoptionMediaSaveQueue = Promise.resolve();
    this.previewUrl = '';
    this.isAnalyzing = false;
    this.analysisResult = '';
    this.currentUser = null;
    this.authMode = 'login';
    this.authError = '';
    this.authLoading = false;
    this.pets = [];
    this.petError = '';
    this.petLoading = false;
    this.petAnalyzing = false;
    this.isSearchingMatches = false;
    this.matchSearchMessage = '';
    this.flowMode = 'lost';
    this.matches = [];
    this.petFormMode = 'profile';
    this.petDraft = this.emptyPetDraft();
    this.currentPage = this.pageFromHash();
    this.adoptionPhotos = [];
    this.adoptionDraft = this.emptyAdoptionDraft();
    this.adoptionCities = [];
    this.adoptionStateSearch = '';
    this.adoptionCityLoading = false;
    this.adoptionCityRequestId = 0;
    this.adoptionCityError = '';
    this.adoptionTestDataLoading = false;
    this.adoptionPreviewUrl = '';
    this.adoptionError = '';
    this.adoptionLoading = false;
    this.adoptionShareMessage = '';
    this.adoptionListings = [];
    window.addEventListener('pagehide', (event) => {
      if (!event.persisted) this.releaseAdoptionSessionLock();
    });
    window.addEventListener('hashchange', () => {
      this.currentPage = this.pageFromHash();
      if (this.currentPage === 'adoption-list') this.loadAdoptionListings();
    });
    if (this.currentPage === 'adoption-list') this.loadAdoptionListings();
    this.unsubscribePets = null;
    onAuthStateChanged(auth, (user) => {
      this.currentUser = user;
      this.unsubscribePets?.();
      this.unsubscribePets = null;
      this.pets = [];
      if (user) {
        const petsQuery = query(
          collection(db, 'users', user.uid, 'pets'),
          orderBy('createdAt', 'desc'),
        );
        this.unsubscribePets = onSnapshot(petsQuery, (snapshot) => {
          this.pets = snapshot.docs.map((pet) => ({ id: pet.id, ...pet.data() }));
        }, () => {
          this.petError = 'Não foi possível carregar seus pets.';
        });
      }
    });
  }

  firstUpdated(changedProperties) {
    super.firstUpdated(changedProperties);
    void this.restoreAdoptionSession();
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    this.persistAdoptionSession(changedProperties);
  }

  pageFromHash() {
    if (location.hash === '#/divulgar-adocao') return 'adoption-form';
    if (location.hash === '#/animais-adocao') return 'adoption-list';
    return 'home';
  }

  navigate(page) {
    location.hash = page === 'adoption-form' ? '/divulgar-adocao' : '/animais-adocao';
  }

  createRenderRoot() {
    return this;
  }

  render() {
    const vaccinationOptions = this.adoptionVaccinationOptions();
    return html`
      <div class="shell">
        <header>
          <button class="brand brand-home" type="button" aria-label="Ir para Perdidos, página inicial" @click=${() => { location.hash = ''; }}>
            <img class="brand-logo" src=${logoUrl} alt="ConectAi pet" />
          </button>
          <nav>
            <!-- <button class="nav-link" @click=${this.openPetForm}>Meus pets</button> -->
            <button class=${`nav-link ${this.currentPage === 'adoption-form' ? 'active' : ''}`} @click=${() => this.navigate('adoption-form')}>Criar arte para adoção</button>
            <span class="nav-span nav-coming-soon" aria-disabled="true">Para adoção</span>
            <span class="nav-span nav-coming-soon" aria-disabled="true">Perdi meu animal</span>
            <span class="nav-span nav-coming-soon" aria-disabled="true">Lares temporários</span>
            ${this.currentUser
              ? html`<button class="nav-cta" @click=${() => signOut(auth)}>Sair</button>`
              : html`<button class="nav-cta" @click=${() => this.openAuth('login')}>Entrar</button>`}
          </nav>
        </header>

        <dialog id="auth-dialog" class="auth-dialog">
          <div class="auth-card">
            <button class="auth-close" type="button" @click=${this.closeAuth} aria-label="Fechar">×</button>
            <span class="eyebrow">CONECTAI PET</span>
            <h2>${this.authMode === 'signup' ? 'Crie sua conta' : 'Bem-vindo de volta'}</h2>
            <p>${this.authMode === 'signup' ? 'Comece a conectar pets, pessoas e reencontros.' : 'Entre para acompanhar seus pets e ocorrências.'}</p>
            <button class="google-button" type="button" @click=${this.handleGoogleSignIn} ?disabled=${this.authLoading}>Continuar com Google</button>
            <div class="auth-divider"><span>ou use seu e-mail</span></div>
            <form @submit=${this.handleAuthSubmit}>
              <label>E-mail<input name="email" type="email" autocomplete="email" required /></label>
              <label>Senha<input name="password" type="password" minlength="6" autocomplete=${this.authMode === 'signup' ? 'new-password' : 'current-password'} required /></label>
              ${this.authError ? html`<p class="auth-error" role="alert">${this.authError}</p>` : ''}
              <button class="primary auth-submit" type="submit" ?disabled=${this.authLoading}>${this.authLoading ? 'Aguarde...' : this.authMode === 'signup' ? 'Criar conta' : 'Entrar'}</button>
            </form>
            <button class="auth-switch" type="button" @click=${() => { this.authMode = this.authMode === 'signup' ? 'login' : 'signup'; this.authError = ''; }}>
              ${this.authMode === 'signup' ? 'Já tenho uma conta' : 'Ainda não tenho uma conta'}
            </button>
          </div>
        </dialog>

        <dialog id="pet-dialog" class="auth-dialog">
          <div class="auth-card">
            <button class="auth-close" type="button" @click=${this.closePetForm} aria-label="Fechar">×</button>
            <span class="eyebrow">MEUS PETS</span>
            <h2>${this.petFormMode === 'lost' ? 'Cadastre o pet perdido' : 'Cadastre seu pet'}</h2>
            <p>${this.petFormMode === 'lost' ? 'Adicione a foto do pet perdido. A IA fará uma sugestão e você poderá revisar tudo antes de publicar a busca.' : 'Envie uma foto e a IA preencherá uma sugestão. Revise tudo antes de salvar.'}</p>
            <form @submit=${this.handlePetSubmit}>
              <label class="pet-photo-field">Foto do pet
                <input name="photo" type="file" accept="image/*" @change=${this.handlePetPhotoChange} />
                ${this.petDraft.photoUrl ? html`<img class="pet-photo-preview" src=${this.petDraft.photoUrl} alt="Prévia do pet" />` : ''}
                <span class="photo-hint">${this.petAnalyzing ? 'Reconhecendo características...' : 'Clique para escolher uma foto'}</span>
              </label>
              <label>Nome<input name="name" type="text" maxlength="15" .value=${this.petDraft.name} @input=${(event) => this.updatePetDraft('name', event)} required /></label>
              <label>Espécie
                <select name="species" .value=${this.petDraft.species} @change=${(event) => this.updatePetDraft('species', event)} required>
                  <option value="">Selecione</option>
                  <option value="cachorro">Cachorro</option>
                  <option value="gato">Gato</option>
                  <option value="outro">Outro</option>
                </select>
              </label>
              <label>Raça<input name="breed" type="text" maxlength="60" .value=${this.petDraft.breed} @input=${(event) => this.updatePetDraft('breed', event)} /></label>
              <label>Cor e pelagem<input name="color" type="text" maxlength="100" .value=${this.petDraft.color} @input=${(event) => this.updatePetDraft('color', event)} required /></label>
              <label>Características especiais<textarea name="notes" maxlength="300" rows="3" .value=${this.petDraft.notes} @input=${(event) => this.updatePetDraft('notes', event)}></textarea></label>
              ${this.petError ? html`<p class="auth-error" role="alert">${this.petError}</p>` : ''}
              <button class="primary auth-submit" type="submit" ?disabled=${this.petLoading || this.petAnalyzing}>${this.petLoading ? 'Salvando...' : this.petAnalyzing ? 'Aguardando análise...' : this.petFormMode === 'lost' ? 'Salvar e buscar matches' : 'Salvar pet'}</button>
            </form>
          </div>
        </dialog>

        ${this.currentPage === 'adoption-form'
          ? html`<main class="adoption-page">
              <button class="adoption-back" @click=${() => location.hash = ''}>← Voltar ao início</button>
              <div class="adoption-heading">
                <span class="eyebrow">ARTE PARA ADOÇÃO</span>
                <h1>Faça a arte do pet para adoção ♡</h1>
                <p>Descreva as características e divulgue até encontrar uma família responsável!</p>
                <button class="secondary adoption-test-button" type="button" @click=${this.fillAdoptionTestData} ?disabled=${this.adoptionTestDataLoading || !this._adoptionSessionReady}>${this.adoptionTestDataLoading ? 'Carregando dados de teste...' : 'Preencher dados de teste'}</button>
              </div>
              <form class="adoption-form" ?inert=${!this._adoptionSessionReady} @submit=${async (event) => { event.preventDefault(); await this.generateAdoptionArt(); if (this.adoptionPreviewUrl && this.adoptionDraft.publish === 'yes') { try { await this.saveAdoptionListing(); } catch (error) { console.error(error); this.adoptionError = 'A arte foi gerada, mas não foi possível publicar no site.'; } } }}>
                <section class="adoption-section"><h2>1. Adicione a foto do pet</h2><p>Quanto mais bonita a foto for, mais rápida será a adoação! (infelizmente isso faz muita diferença)</p>
                  <div class="adoption-photo-grid">
                    <div class="adoption-photo-slot">
                      ${this.adoptionPhotos[0]
                        ? html`<img src=${this.adoptionPhotos[0].url} alt="Prévia da foto do animalzinho" /><button type="button" @click=${() => this.removeAdoptionPhoto(0)}>Remover</button>`
                        : html`<label>Clique aqui para adicionar a foto<input type="file" accept="image/jpeg,image/png,image/webp" @change=${this.handleAdoptionPhotos} /></label>`}
                    </div>
                  </div>
                </section>
                <section class="adoption-section"><h2>2. Informações essenciais</h2>
                  <div class="adoption-grid"><label>Nome do animal *<input required maxlength="60" .value=${this.adoptionDraft.name} @input=${(event) => this.updateAdoptionField('name', event)} /></label>
                    <label>Espécie *<select required .value=${this.adoptionDraft.species} @change=${(event) => this.updateAdoptionField('species', event)}><option value="">Selecione</option><option>Cachorro</option><option>Gato</option><option>Outro</option></select></label>
                    <label>Sexo<select .value=${this.adoptionDraft.sex} @change=${(event) => this.updateAdoptionField('sex', event)}><option value="">Selecione</option><option>Macho</option><option>Fêmea</option></select></label>
                    <label>Porte (tamanho)*<select required .value=${this.adoptionDraft.size} @change=${(event) => this.updateAdoptionField('size', event)}><option value="">Selecione</option><option>Mini</option><option>Pequeno</option><option>Médio</option><option>Grande</option></select></label>
                    <div class="age-field"><label id="title-adption-age" for="adoption-age">Quantos anos o animal tem aproximadamente?</label><div class="age-input-row"><input id="adoption-age" type="text" inputmode="decimal" maxlength="5" pattern="[0-9]{1,2}(,[0-9]{1,2})?" placeholder="Ex.: 2" .value=${this.adoptionDraft.age} ?disabled=${this.adoptionDraft.ageUnknown} @input=${(event) => this.updateAdoptionField('age', event)} /><select aria-label="Unidade da idade" .value=${this.adoptionDraft.ageUnit} ?disabled=${this.adoptionDraft.ageUnknown} @change=${(event) => this.updateAdoptionField('ageUnit', event)}><option value="meses">Meses</option><option value="anos">Anos</option></select><label class="age-unknown"><input type="checkbox" .checked=${this.adoptionDraft.ageUnknown} @change=${this.toggleAgeUnknown} />Não sei</label></div></div>
                </section>
                <section class="adoption-section"><h2>3. Saúde e cuidados</h2><div class="adoption-health-grid">
                  <label>É castrado? *<select required .value=${this.adoptionDraft.isNeutered} @change=${(event) => this.updateAdoptionField('isNeutered', event)}><option value="">Selecione</option><option>Sim</option><option>Não</option><option>Não sei</option></select></label>
                  <div class="vaccination-field"><span class="vaccination-label">Tomou vacinas *</span><div class="vaccination-options">${vaccinationOptions.map((item) => html`<button type="button" class=${this.adoptionDraft.vaccinations.includes(item) ? 'selected' : ''} @click=${() => this.toggleVaccination(item)}>${item}</button>`)}</div>${this.adoptionDraft.vaccinations.includes('Outra') ? html`<label>Qual outra vacina?<input maxlength="100" placeholder="Informe a vacina" .value=${this.adoptionDraft.vaccinationOther} @input=${(event) => this.updateAdoptionField('vaccinationOther', event)} /></label>` : ''}</div>
                </div></section>
                <section class="adoption-section"><h2>4. Personalidade</h2><p>Selecione até 3 características e complete a descrição se necessário.</p>
                  <div class="characteristics-grid">${['Carinhoso','Brincalhão','Dengoso','Calmo','Medroso','Dócil','Independente','Protetor','Sociável','Agitado','Desconfiado','Tranquilo','Bravo'].map((item) => html`<button type="button" class=${this.adoptionDraft.characteristics.includes(item) ? 'selected' : ''} ?disabled=${!this.adoptionDraft.characteristics.includes(item) && this.adoptionDraft.characteristics.length >= 3} @click=${() => this.toggleCharacteristic(item)}>${item}</button>`)}</div>
                  <label>Descrição complementar<textarea rows="2" maxlength="50" .value=${this.adoptionDraft.description} @input=${(event) => this.updateAdoptionField('description', event)}></textarea><small>${this.adoptionDraft.description.length}/50 caracteres</small></label>
                  <div class="adoption-grid"><label>Se dá bem com outros animais?<select .value=${this.adoptionDraft.getsAlongWithAnimals} @change=${(event) => this.updateAdoptionField('getsAlongWithAnimals', event)}><option value="">Selecione</option><option>Sim</option><option>Não</option><option>Não sei</option></select></label>
                    <label>Se dá bem com crianças?<select .value=${this.adoptionDraft.getsAlongWithChildren} @change=${(event) => this.updateAdoptionField('getsAlongWithChildren', event)}><option value="">Selecione</option><option>Sim</option><option>Não</option><option>Não sei</option></select></label></div>
                </section>
                <section class="adoption-section"><h2>5. Localização e contato</h2><div class="adoption-grid"><label>Nome do responsável* <span class="label-hint">(seu primeiro nome)</span><input required maxlength="15" autocomplete="given-name" .value=${this.adoptionDraft.responsibleName} @input=${(event) => this.updateAdoptionField('responsibleName', event)} /></label><label>Telefone *<input required type="tel" autocomplete="tel" maxlength="15" placeholder="(00) 00000-0000" inputmode="tel" .value=${this.adoptionDraft.phone} @input=${(event) => this.updateAdoptionField('phone', event)} /></label><label>Bairro *<input required maxlength="80" .value=${this.adoptionDraft.neighborhood} @input=${(event) => this.updateAdoptionField('neighborhood', event)} /></label>                <label>Estado *<input required list="adoption-states" autocomplete="address-level1" placeholder="Digite ou selecione o estado" .value=${this.adoptionStateSearch} @input=${this.updateAdoptionStateSearch} /><datalist id="adoption-states">${this.constructor.brazilStates.map(([, name]) => html`<option value=${name}></option>`)}</datalist></label><label>Cidade *<input required list="adoption-cities" autocomplete="address-level2" placeholder=${!this.adoptionDraft.state ? 'Selecione o estado primeiro' : this.adoptionCityLoading ? 'Carregando cidades...' : 'Digite ou selecione a cidade'} .value=${this.adoptionDraft.city} ?disabled=${!this.adoptionDraft.state || this.adoptionCityLoading || !!this.adoptionCityError} @input=${(event) => this.updateAdoptionField('city', event)} /><datalist id="adoption-cities">${this.adoptionCities.map((city) => html`<option value=${city.nome}></option>`)}</datalist>${this.adoptionCityError ? html`<small role="alert">${this.adoptionCityError}</small>` : ''}</label></div></section>
                ${this.adoptionError ? html`<p class="adoption-error" role="alert">${this.adoptionError}</p>` : ''}
                <div class="adoption-form-actions">
                  <button class="adoption-restart" type="button" @click=${this.restartAdoptionForm} ?disabled=${this.adoptionLoading || this.adoptionTestDataLoading}>Recomeçar</button>
                  <button class="primary adoption-submit" type="submit" ?disabled=${this.adoptionLoading}>${this.adoptionLoading ? 'Gerando arte...' : 'Gerar arte de divulgação'}</button>
                </div>
              </form>
              ${this.adoptionPreviewUrl ? html`<section class="adoption-preview"><h2>Sua divulgação está pronta</h2><img src=${this.adoptionPreviewUrl} alt="Prévia da arte 1080 por 1912" /><p class="adoption-preview-message">Salve a imagem e compartilhe! Boa sorte ♡</p><div class="adoption-actions"><button class="primary" @click=${this.downloadAdoptionArt}>Baixar imagem</button><button class="secondary" @click=${this.shareAdoptionArt}>Compartilhe</button></div>${this.adoptionShareMessage ? html`<p class="adoption-share-status" role="status">${this.adoptionShareMessage}</p>` : ''}<button class="ghost-button adoption-new-art" type="button" @click=${this.restartAdoptionForm}>Criar nova arte</button></section>` : ''}
            </main>`
          : this.currentPage === 'adoption-list'
            ? html`<main class="adoption-list-page"><button class="adoption-back" @click=${() => location.hash = ''}>← Voltar ao início</button><div class="adoption-heading"><span class="eyebrow">ADOTAR</span><h1>Animais para adoção</h1><p>Conheça animais publicados, entre em contato!</p></div><div class="adoption-list-grid">${this.adoptionListings.length ? this.adoptionListings.map((animal) => html`<article class="adoption-animal-card"><img src=${animal.photo || logoUrl} alt=${animal.name} /><h2>${animal.name}</h2>${animal.sex ? html`<p>${animal.sex}</p>` : ''}${animal.size ? html`<p>Porte: ${animal.size}</p>` : ''}${animal.age ? html`<p>${animal.age}</p>` : ''}<p>${animal.characteristics?.join(' • ')}</p><p>${animal.neighborhood} • ${animal.city}</p>${animal.phone ? html`<p><a href=${`tel:${animal.phone.replace(/[^0-9+]/g, '')}`}>${animal.phone}</a></p>` : ''}</article>`) : html`<p class="empty-pets">Nenhum animal publicado disponível no momento.</p>`}</div></main>`
          : html`<section class="hero">
          <div>
            <div class="badge">TECNOLOGIA PARA O BEM</div>
            <h1>Usamos IA para <span class="highlight">reencontrar seu pet!</span></h1>
            <p>Conectamos características visuais, descrições e localização para identificar possíveis correspondências entre pets perdidos e encontrados.</p>

            <div class="actions">
              <button class="primary" @click=${this.scrollToUpload}>Perdi meu pet</button>
              <button class="secondary" @click=${this.scrollToUpload}>Encontrei um pet</button>
            </div>
          </div>

          <div class="phone">
            <div class="network">
              <div class="network-label">USANDO A TECNOLOGIA PARA AQUELES QUE NÃO SE CONSEGUEM PEDIR AJUDA</div>
              <div class="line" style="top:22%;left:18%;width:210px;transform:rotate(19deg)"></div>
              <div class="line" style="top:39%;left:22%;width:250px;transform:rotate(-12deg)"></div>
              <div class="line" style="top:58%;left:16%;width:235px;transform:rotate(16deg)"></div>
              <div class="line" style="top:74%;left:31%;width:190px;transform:rotate(-23deg)"></div>
              <div class="line" style="top:28%;left:54%;width:170px;transform:rotate(56deg)"></div>
              <div class="line" style="top:66%;left:50%;width:155px;transform:rotate(-52deg)"></div>

              <div class="paw-node" style="top:16%;left:10%"></div>
              <div class="paw-node" style="top:34%;left:16%"></div>
              <div class="paw-node" style="top:57%;left:9%"></div>
              <div class="paw-node" style="top:75%;left:25%"></div>
              <div class="paw-node main" style="top:43%;left:48%"></div>
              <div class="paw-node" style="top:20%;left:78%"></div>
              <div class="paw-node" style="top:62%;left:82%"></div>
            </div>

            <div class="screen">
              <div class="ai-card">
                <small>BUSCANDO ANIMAIS SIMILARES</small>
                <h2>3 conexões detectadas</h2>
                <p>Processando similaridade visual e textual...</p>
              </div>

              <div class="match">
                <strong>Cachorro caramelo</strong>
                <div class="score">92% match</div>
              </div>
              <div class="match">
                <strong>Possível avistamento</strong>
                <div class="score">86% match</div>
              </div>
            </div>
          </div>
        </section>

        ${this.currentUser ? html`
          <section class="pets-section">
            <div class="section-title">
              <span class="eyebrow">MEUS PETS</span>
              <h2>Seus companheiros, sempre por perto.</h2>
              <p>Cadastre os dados dos seus pets para agilizar buscas e facilitar um reencontro.</p>
            </div>
            <div class="pets-toolbar">
              <span>${this.pets.length} ${this.pets.length === 1 ? 'pet cadastrado' : 'pets cadastrados'}</span>
              <button class="primary" @click=${this.openPetForm}>Adicionar pet</button>
            </div>
            <p class="pet-error-inline">${this.petError}</p>
            ${this.pets.length ? html`
              <div class="pets-grid">
                ${this.pets.map((pet) => html`
                  <article class="pet-card">
                    <div class="pet-avatar">${pet.species === 'gato' ? '🐱' : pet.species === 'cachorro' ? '🐶' : '🐾'}</div>
                    <div>
                      <h3>${pet.name}</h3>
                      <p>${pet.species}${pet.breed ? ` · ${pet.breed}` : ''}</p>
                      <small>${pet.color}</small>
                    </div>
                    <button class="pet-remove" type="button" @click=${() => this.removePet(pet.id)} aria-label="Remover ${pet.name}">×</button>
                  </article>
                `)}
              </div>
            ` : html`<div class="empty-pets">Você ainda não cadastrou nenhum pet.</div>`}
          </section>
        ` : ''}

            <section id="upload" class="upload-section">
          <div class="section-title">
                <span class="eyebrow">COMECE UMA BUSCA</span>
                <h2>O que aconteceu com o pet?</h2>
                <p>Escolha uma opção. As duas entradas são conectadas: ocorrências de “Perdi” procuram somente na tabela de “Pets encontrados”.</p>
          </div>
              <div class="flow-choice" role="group" aria-label="Tipo de ocorrência">
                <button class=${this.flowMode === 'lost' ? 'flow-choice-card active' : 'flow-choice-card'} @click=${this.openLostPetForm} type="button">
                  <strong>Perdi meu pet</strong>
                  <span>Enviar foto e buscar na rede de pets encontrados.</span>
                </button>
                <button class=${this.flowMode === 'found' ? 'flow-choice-card active' : 'flow-choice-card'} @click=${() => { this.flowMode = 'found'; }} type="button">
                  <strong>Achei um pet</strong>
                  <span>Enviar foto e publicar na tabela de pets encontrados.</span>
                </button>
              </div>

          <div class="upload-grid">
            <div class="upload-panel">
              ${this.previewUrl
                ? html`
                    <div class="preview-wrap">
                      <img src=${this.previewUrl} alt="Preview do pet enviado" />
                      ${this.isAnalyzing ? html`<div class="scan-line"></div>` : ''}
                      <div class="preview-badge">${this.isAnalyzing ? 'SCANNING IMAGE' : 'IMAGE READY'}</div>
                    </div>
                  `
                : html`
                    <label class="dropzone">
                      <input type="file" accept="image/*" @change=${this.handleFileChange} />
                      <div>
                        <div class="upload-icon">⌁</div>
                        <h3>Adicionar foto do pet</h3>
                        <p>Clique para selecionar uma imagem</p>
                      </div>
                    </label>
                  `}
            </div>

            <div class="analysis-panel">
              <div class="analysis-header">
                <small>GEMINI VISION ANALYSIS</small>
                <span class="analysis-status">${this.isSearchingMatches ? 'BUSCANDO MATCHES' : this.previewUrl ? (this.isAnalyzing ? 'ANALISANDO' : 'CONCLUÍDO') : 'AGUARDANDO FOTO'}</span>
              </div>

              <h3>${this.isSearchingMatches ? 'Buscando possíveis matches...' : this.previewUrl ? (this.isAnalyzing ? 'Analisando características do pet...' : 'Foto pronta para buscar') : 'A análise começa quando uma foto é enviada'}</h3>

              <div class="progress-track">
                <div class="progress-bar" style="width: ${this.previewUrl ? (this.isAnalyzing ? '76%' : '100%') : '8%'}"></div>
              </div>

              ${this.analysisResult ? html`
                <div class="analysis-result">
                  <small style="color: var(--secondary);">RESULTADO DA ANÁLISE</small>
                  <p>${this.analysisResult}</p>
                </div>
              ` : html`
                <div class="signal-list">
                  <div class="signal">
                    <span>Cor/Pelagem</span>
                    <span>${this.previewUrl ? (this.isAnalyzing ? 'analisando' : 'detectada') : 'pendente'}</span>
                  </div>
                  <div class="signal">
                    <span>Raça/Porte</span>
                    <span>${this.previewUrl ? (this.isAnalyzing ? 'analisando' : 'identificada') : 'pendente'}</span>
                  </div>
                  <div class="signal">
                    <span>Características Únicas</span>
                    <span>${this.previewUrl ? (this.isAnalyzing ? 'processando' : 'mapeadas') : 'pendente'}</span>
                  </div>
                </div>
              `}

              <div class="analysis-actions">
                <button class="primary" @click=${this.searchMatches} ?disabled=${!this.previewUrl || this.isAnalyzing || this.isSearchingMatches}>${this.isSearchingMatches ? 'Processando...' : this.flowMode === 'lost' ? 'Buscar em pets encontrados' : 'Publicar pet encontrado'}</button>
                <button class="ghost-button" @click=${this.resetUpload}>Trocar imagem</button>
              </div>
            </div>
          </div>
        </section>

        <section id="matches" class="matches-section">
          <div class="section-title">
            <span class="eyebrow">BUSCA VISUAL</span>
            <h2>Possíveis matches</h2>
            <p>${this.matchSearchMessage || 'Os matches desta busca serão feitos exclusivamente contra a tabela de pets encontrados.'}</p>
          </div>
          ${this.matches.length ? html`
            <div class="matches-grid">
              ${this.matches.map((match) => html`
                <article class="match-result-card match-list-card">
                  <div class="match-result-content">
                    <small>${match.score}% DE COMPATIBILIDADE</small>
                    <h3>${match.name || 'Pet encontrado'}</h3>
                    <p>${match.species}${match.breed ? ` · ${match.breed}` : ''}</p>
                    <p>${match.color || 'Características em análise'}</p>
                  </div>
                </article>
              `)}
            </div>
          ` : html`<div class="matches-empty">
            <span class="matches-empty-icon">⌕</span>
            <div>
              <h3>${this.isSearchingMatches ? 'Comparando com pets encontrados...' : 'Nenhum match exibido ainda'}</h3>
              <p>Somente publicações da tabela de pets encontrados entram nesta comparação.</p>
            </div>
          </div>`}
        </section>

        <section class="how-it-works">
          <div class="section-title">
            <span class="eyebrow">COMO FUNCIONA</span>
            <h2>Entenda o processo de reencontro</h2>
            <p>Nossa IA trabalha em etapas para encontrar o melhor match entre pets perdidos e encontrados.</p>
          </div>

          <div class="steps-grid">
            <div class="step-card">
              <div class="step-number">1</div>
              <h3>Upload da Foto</h3>
              <p>Você envia uma foto clara do seu pet. Quanto melhor a qualidade da imagem, mais precisa será a análise.</p>
              <div class="step-icon">📸</div>
            </div>

            <div class="step-card">
              <div class="step-number">2</div>
              <h3>Análise Neural</h3>
              <p>A IA analisa características visuais: cor, porte, raça, marcas especiais e padrões únicos do animal.</p>
              <div class="step-icon">🧠</div>
            </div>

            <div class="step-card">
              <div class="step-number">3</div>
              <h3>Busca Inteligente</h3>
              <p>O sistema cruza dados visuais com localização, data e descrições para encontrar possíveis correspondências.</p>
              <div class="step-icon">🔍</div>
            </div>

            <div class="step-card">
              <div class="step-number">4</div>
              <h3>Resultados Ranqueados</h3>
              <p>Receba uma lista de possíveis matches ordenados por compatibilidade, da mais provável para a menos provável.</p>
              <div class="step-icon">✅</div>
            </div>

            <div class="step-card">
              <div class="step-number">5</div>
              <h3>Verificação Humana</h3>
              <p>Você analisa cada sugestão e entra em contato direto com quem encontrou ou procura pelo animal.</p>
              <div class="step-icon">🤝</div>
            </div>

            <div class="step-card">
              <div class="step-number">6</div>
              <h3>Reencontro Seguro</h3>
              <p>Combinam detalhes, marcas de identificação e fazem o reencontro com segurança e confiança.</p>
              <div class="step-icon">🐾</div>
            </div>
          </div>

          <div class="how-it-works-note">
            <p class="disclaimer"><strong>Importante:</strong> A IA suporta sua busca, mas não substitui o julgamento humano. Sempre verifique as características do animal antes de se encontrar com alguém.</p>
          </div>
        </section>
        `}
      </div>
    `;
  }
}


customElements.define('cade-meu-pet-app', CadeMeuPetApp);
