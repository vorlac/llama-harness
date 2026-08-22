; case display-066-closure
; expect exit=0 stdout="11\n"
.func main arity=0 locals=0
  CLOSURE helper
  TOSTR
  LEN
  PRINT
  RET
.end
.func helper arity=0 locals=0
  PUSH_NIL
  RET
.end
