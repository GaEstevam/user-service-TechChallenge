import express, { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import amqp from 'amqplib';
import jwt, { JwtPayload } from 'jsonwebtoken';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const JWT_SECRET = process.env.JWT_SECRET || 'secretkey';

// Definir a interface para o usuário
interface User {
  id: number;
  name: string;
  email: string;
  password: string;
  role: string;
}

// Adicionar um tipo para req.user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

const users: User[] = [];

// Middleware para autenticação
function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ message: 'Token ausente' }); // Não usa return, apenas manipula a resposta
    return; // Para garantir que a execução não continue
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      res.status(403).json({ message: 'Token inválido' }); // Não usa return, apenas manipula a resposta
      return; // Para garantir que a execução não continue
    }

    req.user = user as JwtPayload;
    next(); // Passa para o próximo middleware ou rota
  });
}

// Rotas protegidas
app.get('/users', authenticateToken, (req: Request, res: Response): void => {
  res.json(users); // Apenas envia a resposta, sem retornar explicitamente
});

app.get('/users/:id', authenticateToken, (req: Request, res: Response): void => {
  const user = users.find(u => u.id === Number(req.params.id));
  if (user) {
    res.json(user); // Envia a resposta do usuário encontrado
  } else {
    res.status(404).json({ message: 'Usuário não encontrado' }); // Envia o erro, sem usar return
  }
});

app.put('/users/:id', authenticateToken, (req: Request, res: Response): void => {
  const index = users.findIndex(u => u.id === Number(req.params.id));
  if (index === -1) {
    res.status(404).json({ message: 'Usuário não encontrado' }); // Envia o erro
  } else {
    users[index] = { ...users[index], ...req.body };
    res.json(users[index]); // Atualiza e envia o usuário atualizado
  }
});

app.delete('/users/:id', authenticateToken, (req: Request, res: Response): void => {
  const index = users.findIndex(u => u.id === Number(req.params.id));
  if (index === -1) {
    res.status(404).json({ message: 'Usuário não encontrado' }); // Envia o erro
  } else {
    users.splice(index, 1);
    res.json({ message: 'Usuário removido' }); // Envia a confirmação da remoção
  }
});

// Conectar no RabbitMQ e escutar eventos de criação de usuário
async function connectRabbitMQ(): Promise<void> {
  try {
    const connection = await amqp.connect('amqp://localhost');
    const channel = await connection.createChannel();
    const queue = 'user_created';

    await channel.assertQueue(queue, { durable: true });  // Garante que a fila exista

    channel.consume(queue, (msg) => {
      if (msg !== null) {
        const user: User = JSON.parse(msg.content.toString());
        users.push(user);
        console.log('📥 Usuário recebido via RabbitMQ:', user);
        channel.ack(msg);
      }
    }, { noAck: false });

    console.log('✅ Conectado ao RabbitMQ e escutando a fila "user_created"');
  } catch (error) {
    console.error('❌ Erro ao conectar no RabbitMQ:', error);
  }
}

connectRabbitMQ();

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`🚀 User Service rodando na porta ${PORT}`));
