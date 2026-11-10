import {
  addDoc,
  analyzePetImage,
  collection,
  db,
  getDocs,
  serverTimestamp,
} from '../../services/firebase.js';

export const withMatching = (Base) => class extends Base {
  async handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    this.previewUrl = URL.createObjectURL(file);
    this.selectedPhotoName = file.name;
    this.isAnalyzing = true;
    this.analysisResult = '';

    try {
      // Converter arquivo para base64
      const base64 = await this.fileToBase64(file);

      const analysis = await analyzePetImage(base64, file.type);
      this.analysisResult = [
        analysis.species && `Espécie: ${analysis.species}`,
        analysis.breed && `Raça provável: ${analysis.breed}`,
        analysis.color && `Cor/pelagem: ${analysis.color}`,
        analysis.notes && `Características: ${analysis.notes}`,
      ].filter(Boolean).join('\n');
    } catch (error) {
      console.error('Erro na análise:', error);
      this.analysisResult = 'Erro ao analisar a imagem. Tente novamente.';
    }

    this.isAnalyzing = false;
  }

  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
    });
  }

  async analyzeImageWithOpenAI(base64, mimeType, structured = false) {
    return analyzePetImage(base64, mimeType);
    /*
    if (!import.meta.env.VITE_OPENAI_API_KEY) {
      throw new Error('VITE_OPENAI_API_KEY não configurada');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4-vision-preview',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64}`,
                },
              },
              {
                type: 'text',
                text: structured
                  ? 'Analise a foto do pet e retorne somente um JSON válido, sem markdown, com exatamente estas chaves: name (string vazia se não for possível identificar), species (somente cachorro, gato ou outro), breed (raça provável ou string vazia), color (cor e pelagem), notes (características visíveis e marcas especiais). Não invente o nome do animal.'
                  : 'Analise esta foto de um pet e descreva em detalhes: cor/pelagem, porte, raça provável, características únicas, marcas especiais. Seja conciso e preciso para fins de identificação.',
              },
            ],
          },
        ],
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      throw new Error(`Erro OpenAI: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    if (structured) {
      const normalized = content.replace(/^```json\s*|\s*```$/g, '').trim();
      return JSON.parse(normalized);
    }
    return content || 'Análise não disponível';
    */
  }

  resetUpload() {
    this.previewUrl = '';
    this.isAnalyzing = false;
    this.isSearchingMatches = false;
    this.matchSearchMessage = '';
  }

  async searchMatches() {
    if (!this.previewUrl || this.isAnalyzing || this.isSearchingMatches) return;
    if (!this.currentUser) {
      this.openAuth('login');
      return;
    }
    this.isSearchingMatches = true;
    this.matchSearchMessage = '';
    try {
      const analysis = this.parseAnalysisResult();
      if (this.flowMode === 'found') {
        await addDoc(collection(db, 'foundPets'), {
          ...analysis,
          reporterId: this.currentUser.uid,
          sourcePhotoName: this.selectedPhotoName || '',
          createdAt: serverTimestamp(),
        });
        this.matches = [];
        this.matchSearchMessage = 'Pet encontrado publicado. Ele ficará disponível para buscas de pets perdidos.';
      } else {
        await addDoc(collection(db, 'lostReports'), {
          ...analysis,
          reporterId: this.currentUser.uid,
          sourcePhotoName: this.selectedPhotoName || '',
          createdAt: serverTimestamp(),
        });
        const snapshot = await getDocs(collection(db, 'foundPets'));
        this.matches = snapshot.docs
          .map((match) => ({ id: match.id, ...match.data() }))
          .map((match) => ({ ...match, score: this.matchScore(analysis, match) }))
          .filter((match) => match.score >= 35)
          .sort((a, b) => b.score - a.score)
          .slice(0, 12);
        this.matchSearchMessage = this.matches.length
          ? `${this.matches.length} possível(is) match(es) encontrado(s) na tabela de pets encontrados.`
          : 'Nenhum possível match foi encontrado na tabela de pets encontrados.';
      }
    } catch (error) {
      console.error('Erro ao publicar e buscar matches:', error);
      this.matchSearchMessage = 'Não foi possível concluir a publicação e busca. Tente novamente.';
    } finally {
      this.isSearchingMatches = false;
    }
    this.renderRoot?.querySelector('#matches')?.scrollIntoView({ behavior: 'smooth' });
  }

  parseAnalysisResult() {
    const lines = this.analysisResult.split('\n');
    const value = (label) => lines.find((line) => line.startsWith(label))?.replace(label, '').trim() || '';
    return {
      species: value('Espécie:') || 'outro',
      breed: value('Raça provável:'),
      color: value('Cor/pelagem:'),
      notes: value('Características:'),
    };
  }

  matchScore(source, candidate) {
    let score = 0;
    if (source.species && source.species === candidate.species) score += 40;
    if (source.breed && candidate.breed && source.breed.toLowerCase() === candidate.breed.toLowerCase()) score += 25;
    if (source.color && candidate.color && source.color.toLowerCase().split(' ')[0] === candidate.color.toLowerCase().split(' ')[0]) score += 20;
    if (source.notes && candidate.notes) score += 15;
    return score;
  }

  scrollToUpload() {
    this.renderRoot?.querySelector('#upload')?.scrollIntoView({ behavior: 'smooth' });
  }
};
