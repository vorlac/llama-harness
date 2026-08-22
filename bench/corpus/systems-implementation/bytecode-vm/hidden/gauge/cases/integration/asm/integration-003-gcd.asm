; case integration-003-gcd
; expect exit=0 stdout="6\n1\n25\n12\n7\n"
.func main arity=0 locals=0
  CLOSURE gcd
  PUSH_INT 48
  PUSH_INT 18
  CALL 2
  PRINT
  CLOSURE gcd
  PUSH_INT 17
  PUSH_INT 5
  CALL 2
  PRINT
  CLOSURE gcd
  PUSH_INT 100
  PUSH_INT 75
  CALL 2
  PRINT
  CLOSURE gcd
  PUSH_INT 12
  PUSH_INT 12
  CALL 2
  PRINT
  CLOSURE gcd
  PUSH_INT 7
  PUSH_INT 0
  CALL 2
  PRINT
  RET
.end
.func gcd arity=2 locals=3
top:
  LOAD_LOCAL 1
  PUSH_INT 0
  EQ
  JMP_IF_TRUE done
  LOAD_LOCAL 1
  STORE_LOCAL 2
  LOAD_LOCAL 0
  LOAD_LOCAL 1
  MOD
  STORE_LOCAL 1
  LOAD_LOCAL 2
  STORE_LOCAL 0
  JMP top
done:
  LOAD_LOCAL 0
  RET
.end
