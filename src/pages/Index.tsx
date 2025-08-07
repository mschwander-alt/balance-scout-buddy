import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';

const Index = () => {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-foreground">Audit Agent</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              Willkommen, {user?.email}
            </span>
            <Button variant="outline" onClick={signOut}>
              Abmelden
            </Button>
          </div>
        </div>
      </header>
      
      <main className="container mx-auto px-4 py-8">
        <div className="text-center">
          <h2 className="text-4xl font-bold mb-4 text-foreground">
            Willkommen bei Audit Agent
          </h2>
          <p className="text-xl text-muted-foreground mb-8">
            Ihre Prüfungssoftware für Financial Auditing
          </p>
          <div className="bg-card border border-border rounded-lg p-6">
            <p className="text-muted-foreground">
              Dashboard wird hier aufgebaut...
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
