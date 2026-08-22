; case control-048-sign
; expect exit=0 stdout="negative\n"
.func main arity=0 locals=1
  PUSH_INT -5
  STORE_LOCAL 0
  LOAD_LOCAL 0
  PUSH_INT 0
  GT
  JMP_IF_FALSE notpos
  PUSH_STR "positive"
  PRINT
  JMP done
notpos:
  LOAD_LOCAL 0
  PUSH_INT 0
  LT
  JMP_IF_FALSE iszero
  PUSH_STR "negative"
  PRINT
  JMP done
iszero:
  PUSH_STR "zero"
  PRINT
done:
  RET
.end
