import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Upload, Building2, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface CompanySettings {
  company_name?: string;
  logo_path?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
}

interface CompanySettingsProps {
  onSettingsChange?: (settings: CompanySettings) => void;
}

export const CompanySettings: React.FC<CompanySettingsProps> = ({ onSettingsChange }) => {
  const { user } = useAuth();
  const [settings, setSettings] = useState<CompanySettings>({});
  const [isLoading, setIsLoading] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>('');

  // Load existing settings
  useEffect(() => {
    loadSettings();
  }, [user]);

  const loadSettings = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('company_settings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setSettings(data);
        if (data.logo_path) {
          loadLogoPreview(data.logo_path);
        }
        onSettingsChange?.(data);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const loadLogoPreview = async (logoPath: string) => {
    try {
      const { data, error } = await supabase.storage
        .from('logos')
        .createSignedUrl(logoPath, 3600);

      if (error) throw error;
      setLogoPreview(data.signedUrl);
    } catch (error) {
      console.error('Error loading logo preview:', error);
    }
  };

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Bitte wählen Sie ein Bilddatei aus');
      return;
    }

    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Logo darf nicht größer als 5MB sein');
      return;
    }

    setLogoFile(file);
    
    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setLogoPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const uploadLogo = async (file: File): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${user!.id}-${Date.now()}.${fileExt}`;
    const filePath = `logos/${fileName}`;

    // Delete old logo if exists
    if (settings.logo_path) {
      await supabase.storage
        .from('logos')
        .remove([settings.logo_path]);
    }

    const { error: uploadError } = await supabase.storage
      .from('logos')
      .upload(filePath, file);

    if (uploadError) throw uploadError;

    return filePath;
  };

  const handleSave = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      let logoPath = settings.logo_path;

      // Upload new logo if selected
      if (logoFile) {
        logoPath = await uploadLogo(logoFile);
      }

      const settingsData = {
        ...settings,
        logo_path: logoPath,
        user_id: user.id
      };

      const { data, error } = await supabase
        .from('company_settings')
        .upsert(settingsData, { onConflict: 'user_id' })
        .select()
        .single();

      if (error) throw error;

      setSettings(data);
      setLogoFile(null);
      onSettingsChange?.(data);
      toast.success('Firmeneinstellungen gespeichert');

    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Fehler beim Speichern der Einstellungen');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteLogo = async () => {
    if (!settings.logo_path) return;

    try {
      await supabase.storage
        .from('logos')
        .remove([settings.logo_path]);

      const updatedSettings = { ...settings, logo_path: undefined };
      const { error } = await supabase
        .from('company_settings')
        .update({ logo_path: null })
        .eq('user_id', user!.id);

      if (error) throw error;

      setSettings(updatedSettings);
      setLogoPreview('');
      onSettingsChange?.(updatedSettings);
      toast.success('Logo entfernt');

    } catch (error) {
      console.error('Error deleting logo:', error);
      toast.error('Fehler beim Entfernen des Logos');
    }
  };

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          Firmeneinstellungen
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Logo Upload Section */}
        <div className="space-y-4">
          <Label className="text-base font-medium">Firmenlogo</Label>
          
          <div className="flex items-center gap-4">
            {logoPreview && (
              <div className="relative">
                <img 
                  src={logoPreview} 
                  alt="Firmenlogo" 
                  className="w-24 h-24 object-contain border rounded-lg bg-muted/30"
                />
                <Button
                  size="sm"
                  variant="destructive"
                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full p-0"
                  onClick={handleDeleteLogo}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            )}
            
            <div className="flex-1">
              <div className="relative">
                <Input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <Button
                  variant="outline"
                  className="w-full flex items-center gap-2"
                >
                  <Upload className="h-4 w-4" />
                  Logo hochladen
                </Button>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                PNG, JPG oder SVG (max. 5MB)
              </p>
            </div>
          </div>
        </div>

        {/* Company Information */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="company_name">Firmenname</Label>
            <Input
              id="company_name"
              value={settings.company_name || ''}
              onChange={(e) => setSettings({ ...settings, company_name: e.target.value })}
              placeholder="Ihr Firmenname"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">E-Mail</Label>
            <Input
              id="email"
              type="email"
              value={settings.email || ''}
              onChange={(e) => setSettings({ ...settings, email: e.target.value })}
              placeholder="firma@beispiel.de"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Telefon</Label>
            <Input
              id="phone"
              value={settings.phone || ''}
              onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
              placeholder="+49 123 456789"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              value={settings.website || ''}
              onChange={(e) => setSettings({ ...settings, website: e.target.value })}
              placeholder="https://www.beispiel.de"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="address">Adresse</Label>
          <Textarea
            id="address"
            value={settings.address || ''}
            onChange={(e) => setSettings({ ...settings, address: e.target.value })}
            placeholder="Straße und Hausnummer
PLZ und Ort"
            rows={3}
          />
        </div>

        <Button 
          onClick={handleSave}
          disabled={isLoading}
          className="w-full"
        >
          <Save className="h-4 w-4 mr-2" />
          {isLoading ? 'Speichern...' : 'Einstellungen speichern'}
        </Button>
      </CardContent>
    </Card>
  );
};