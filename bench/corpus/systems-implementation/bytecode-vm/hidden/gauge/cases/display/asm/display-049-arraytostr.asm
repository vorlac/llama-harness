; case display-049-arraytostr
; expect exit=0 stdout="[\"back\\\\slash\"]\n"
.func main arity=0 locals=0
  PUSH_STR "back\\slash"
  NEW_ARRAY 1
  TOSTR
  PRINT
  RET
.end
