; case strops-049-len
; expect exit=0 stdout="100\n"
.func main arity=0 locals=0
  PUSH_STR "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  LEN
  PRINT
  RET
.end
